'use strict';

define('admin/plugins/reactions', [
	'settings', 'alerts', 'hooks', 'benchpress', 'emoji-dialog', 'emoji',
], function (Settings, alerts, hooks, benchpress, emojiDialog, emoji) {
	const ACP = {};
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

				// Wire edit button — falls back to the default modal flow by re-opening bootbox
				// with a single-emoji form. We keep edit simple: just allow removing & re-adding.
				$item.find('[data-type="edit"]').on('click', function () {
					require(['bootbox'], function (bootbox) {
						benchpress.render(formTpl, {}).then(function (editHtml) {
							const $editForm = $(editHtml);
							$editForm.deserialize({ reaction: itemData.reaction });
							const modal = bootbox.confirm($editForm, function (save) {
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
					});
				});

				hooks.fire('action:settings.sorted-list.parse', { itemHtml: $item });
			});
		});
	}

	// Open the standard emoji-dialog but stay open until the user clicks elsewhere or presses Done.
	// Collect every clicked emoji into an array, then pass them all back at once.
	function openMultiEmojiPicker(anchorEl, onDone) {
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

		// Inject a "Done" bar into the dialog if not already present.
		setTimeout(function () {
			const $dialog = $('#emoji-dialog');
			if (!$dialog.length) return;
			$dialog.find('.reactions-multi-done').remove();
			const $bar = $('<div class="reactions-multi-done" style="position:sticky;bottom:0;background:var(--bs-body-bg,#fff);padding:6px;border-top:1px solid var(--bs-border-color,#ddd);text-align:end;"></div>');
			const $btn = $('<button type="button" class="btn btn-primary btn-sm">Done</button>');
			$btn.on('click', function () {
				emojiDialog.dialogActions.close($dialog);
				$bar.remove();
				onDone(picked);
			});
			$bar.append($btn);
			$dialog.append($bar);

			// Also fire onDone if dialog closes by other means (e.g. clicking outside).
			const closeObserver = new MutationObserver(function () {
				if (!$dialog.hasClass('open')) {
					closeObserver.disconnect();
					$bar.remove();
					onDone(picked);
				}
			});
			closeObserver.observe($dialog[0], { attributes: true, attributeFilter: ['class'] });
		}, 0);
	}

	return ACP;
});
