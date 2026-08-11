'use strict';

define('admin/plugins/reactions', [
	'settings', 'alerts', 'hooks', 'benchpress', 'emoji-dialog', 'emoji', 'modals', 'translator',
], function (Settings, alerts, hooks, benchpress, emojiDialog, emoji, modals, translator) {
	const ACP = {};
	let multiPickerObserver = null;
	let emojiDialogInitPromise = null;
	ACP.init = function () {
		emoji.init(function () {
			Settings.load('reactions', $('.reactions-settings'), onSettingsLoaded);
		});
	};

	function onSettingsLoaded() {
		hooks.on('action:settings.sorted-list.parse', function (data) {
			const reactionEl = data.itemHtml.find('[data-reaction]');
			if (reactionEl.length) {
				const reaction = reactionEl.attr('data-reaction');
				if (reaction) {
					const foundEmoji = emoji.table[reaction];
					if (foundEmoji) {
						reactionEl.html(emoji.buildEmoji(foundEmoji));
					}
				}
			}
		});

		hooks.on('action:settings.sorted-list.modal', function (data) {
			const { modal } = data;
			modal.removeAttr('tabindex');
			modal.find('#reaction').off('click').on('click', function () {
				emojiDialog.toggle(modal.find('#reaction')[0], function (_, name, dialog) {
					emojiDialog.dialogActions.close(dialog);
					modal.find('#reaction').val(name);
				});
			});
			modal.off('hide.bs.modal').on('hide.bs.modal', function () {
				emojiDialog.dialogActions.close($('#emoji-dialog'));
			});
		});

		// Replace the default Add button for the allowed-post-reactions list with a multi-pick flow.
		hooks.on('action:settings.sorted-list.loaded', function (data) {
			if (data.key !== 'allowed-post-reactions') return;
			const $container = $(data.containerEl);
			const $defaultAddBtn = $container.find('[data-type="add"]');
			if ($defaultAddBtn.data('reactionsReplaced')) return;
			$defaultAddBtn.data('reactionsReplaced', true);

			// Strip default click handlers and replace behavior.
			$defaultAddBtn.off('click').on('click', function (e) {
				e.preventDefault();
				openMultiEmojiPicker($defaultAddBtn[0], function (selectedNames) {
					if (!selectedNames || !selectedNames.length) return;
					const existing = collectExistingReactions($container);
					selectedNames.forEach(function (name) {
						if (existing.has(name)) return;
						existing.add(name);
						addItem($container, 'allowed-post-reactions', { reaction: name });
					});
				});
			});
		});

		$('#save').on('click', function () {
			Settings.save('reactions', $('.reactions-settings'), function () {
				alerts.alert({
					type: 'success',
					alert_id: 'reactions-saved',
					title: 'Settings Saved',
					message: 'Reactions plugin settings saved',
					timeout: 3000,
				});
			});
		});
	}

	function collectExistingReactions($container) {
		const set = new Set();
		$container.find('[data-type="item"]').each(function () {
			const uuid = $(this).attr('data-sorted-list-uuid');
			const $form = $('#content').find('[data-sorted-list-uuid="' + uuid + '"][data-sorted-list-object="allowed-post-reactions"]');
			const val = ($form.find('input[name="reaction"]').val() || '').trim();
			if (val) set.add(val);
		});
		return set;
	}

	// Build a list-item + hidden form pair, matching the structure produced by NodeBB's
	// sorted-list module so that Save serializes them correctly.
	function addItem($container, key, itemData) {
		const itemTpl = $container.attr('data-item-template');
		const formTpl = $container.attr('data-form-template');
		const uuid = utils.generateUUID();

		// Hidden form (for serializeForm on save).
		benchpress.render(formTpl, {}).then(function (formHtml) {
			const $form = $('<form></form>')
				.attr('data-sorted-list-uuid', uuid)
				.attr('data-sorted-list-object', key)
				.append($(formHtml).children());
			$form.deserialize(itemData);
			$('#content').append($form.hide());

			// Visible list item.
			app.parseAndTranslate(itemTpl, itemData, function ($itemHtml) {
				const $item = $($itemHtml);
				$item.attr('data-sorted-list-uuid', uuid);
				$container.find('[data-type="list"]').append($item);

				// Render emoji preview.
				const $reactionEl = $item.find('[data-reaction]');
				if ($reactionEl.length) {
					const found = emoji.table[itemData.reaction];
					if (found) $reactionEl.html(emoji.buildEmoji(found));
				}

				// Wire remove button.
				$item.find('[data-type="remove"]').on('click', function () {
					$item.remove();
					$form.remove();
				});

				// Wire edit button — falls back to the default modal flow by re-opening a
				// single-emoji form. We keep edit simple: just allow removing & re-adding.
				$item.find('[data-type="edit"]').on('click', async function () {
					const editHtml = await benchpress.render(formTpl, {});
					const $editForm = $(editHtml);
					$editForm.deserialize({ reaction: itemData.reaction });
					const modal = await modals.confirm($editForm, function (save) {
						if (!save) return;
						const newName = (modal.find('input[name="reaction"]').val() || '').trim();
						if (!newName) return;
						itemData.reaction = newName;
						$form.find('input[name="reaction"]').val(newName);
						const found = emoji.table[newName];
						$reactionEl.attr('data-reaction', newName);
						if (found) $reactionEl.html(emoji.buildEmoji(found));
						$item.find('strong').text(' ' + newName);
					});
					hooks.fire('action:settings.sorted-list.modal', { modal });
				});

				hooks.fire('action:settings.sorted-list.parse', { itemHtml: $item });
			});
		});
	}

	// emoji-dialog lazily creates & fetches its #emoji-dialog element on first use
	// (emojiDialog.init does an async JSON fetch + render), so callers can't assume it
	// already exists in the DOM right after calling toggle(). Wait for init explicitly
	// instead of guessing with a timeout. Concurrent calls (e.g. a double-click on Add
	// before the first init resolves) share the same in-flight init instead of each
	// calling emojiDialog.init() independently — that module always appends a fresh
	// element with no de-dupe of its own, so two concurrent calls would otherwise leave
	// two #emoji-dialog nodes in the DOM.
	function ensureEmojiDialog(callback) {
		const $existing = $('#emoji-dialog');
		if ($existing.length) {
			callback($existing);
			return;
		}
		if (!emojiDialogInitPromise) {
			emojiDialogInitPromise = new Promise(function (resolve) {
				emojiDialog.init(resolve);
			});
		}
		emojiDialogInitPromise.then(callback);
	}

	// Open the standard emoji-dialog but stay open until the user clicks elsewhere or
	// presses Done, collecting every clicked emoji into an array before passing them
	// all back at once.
	function openMultiEmojiPicker(anchorEl, onDone) {
		ensureEmojiDialog(function ($dialog) {
			// A stale observer from an abandoned previous session (e.g. the admin
			// navigated away mid-pick) must be dropped before we touch the dialog's
			// class, or forcing it closed below would fire that old callback instead.
			if (multiPickerObserver) {
				multiPickerObserver.disconnect();
				multiPickerObserver = null;
			}

			// emojiDialog.toggle() closes the dialog if it's already open (e.g. left open
			// from an unrelated interaction) instead of opening it for us — start from a
			// known closed state so the call below always opens fresh.
			if ($dialog.hasClass('open')) {
				emojiDialog.dialogActions.close($dialog);
			}

			// A previous session's checkmarks are still in the markup (toggle() never
			// clears them) — without this a just-closed pick would visibly look
			// "already selected" on reopen despite the new `picked` array being empty.
			$dialog.find('.reactions-picked').removeClass('reactions-picked');

			const picked = [];
			emojiDialog.toggle(anchorEl, function (e, name) {
				const idx = picked.indexOf(name);
				if (idx >= 0) {
					picked.splice(idx, 1);
					$(e.currentTarget).removeClass('reactions-picked');
				} else {
					picked.push(name);
					$(e.currentTarget).addClass('reactions-picked');
				}
			});

			attachMultiDoneBar($dialog, picked, onDone);
		});
	}

	// Injects a "Done" bar into the (now open) dialog and resolves `onDone` either when
	// it's clicked or when the dialog closes by any other means (e.g. clicking outside).
	function attachMultiDoneBar($dialog, picked, onDone) {
		$dialog.find('.reactions-multi-done').remove();

		const $bar = $('<div class="reactions-multi-done"></div>');
		const $btn = $('<button type="button" class="btn btn-primary btn-sm"></button>');
		translator.translate('[[reactions:settings.allowed-post-reactions.done]]', function (text) {
			$btn.text(text);
		});
		$btn.on('click', function () {
			emojiDialog.dialogActions.close($dialog);
		});
		$bar.append($btn);
		$dialog.append($bar);

		let settled = false;
		function settle() {
			if (settled) return;
			settled = true;
			multiPickerObserver.disconnect();
			multiPickerObserver = null;
			$bar.remove();
			onDone(picked.slice());
		}

		multiPickerObserver = new MutationObserver(function () {
			if (!$dialog.hasClass('open')) settle();
		});
		multiPickerObserver.observe($dialog[0], { attributes: true, attributeFilter: ['class'] });
	}

	return ACP;
});
