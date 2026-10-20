'use strict';

$(document).ready(function () {
	setupReactions();
	let alerts;
	let mouseOverReactionEl;
	let tooltipTimeoutId = 0;
	function setupReactions() {
		createReactionTooltips();
		require(['hooks', 'alerts'], function (hooks, _alerts) {
			alerts = _alerts;
			hooks.on('action:ajaxify.end', function () {
				if (ajaxify.data.template.topic) {
					setupPostReactions();
					hideOwnPostReactionButtons();
				}
			});
			// posts that are loaded dynamically (infinite scroll, new replies)
			hooks.on('action:posts.loaded', function () {
				hideOwnPostReactionButtons();
			});
			// switchChat uses action:chat.loaded and not action:ajaxify.end
			hooks.on('action:chat.loaded', function (container) {
				if (ajaxify.data.template.chats && ajaxify.data.roomId) {
					setupMessageReactions(container);
				} else if (container.hasClass('chat-modal') || container.attr('component') === 'chat/widget') {
					setupMessageReactions(container);
				}
			});
		});

		socket.on('event:post_deleted', function (data) {
			$('[component="post/reaction/add"][data-pid="' + data.pid + '"]').addClass('hidden');
		});

		socket.on('event:post_restored', function (data) {
			$('[component="post/reaction/add"][data-pid="' + data.pid + '"]').removeClass('hidden');
		});

		socket.on('event:chats.delete', function (mid) {
			$('[component="message/reactions"][data-mid="' + mid + '"]').addClass('hidden');
		});

		socket.on('event:chats.restore', function (msg) {
			$('[component="message/reactions"][data-mid="' + msg.mid + '"]').removeClass('hidden');
		});
	}

	function isOwnPost(el) {
		if (!app.user || !app.user.uid || config.allowSelfReactions) {
			return false;
		}
		const postUid = $(el).closest('[component="post"]').attr('data-uid');
		return parseInt(postUid, 10) === parseInt(app.user.uid, 10);
	}

	// the post owner can't add reactions to their own post (enforced on the server too)
	function hideOwnPostReactionButtons() {
		$('[component="post/reaction/add"]').each(function () {
			if (isOwnPost(this)) {
				$(this).addClass('own-post');
			}
		});
	}

	// Opens a dialog with everyone who used this reaction (avatars + links to profiles)
	function openAllUsersModal($el) {
		const pid = $el.attr('data-pid');
		const mid = $el.attr('data-mid');
		const reaction = $el.attr('data-reaction');
		const type = pid ? 'post' : 'message';
		socket.emit('plugins.reactions.getReactionUsers', {
			type: type,
			pid: pid,
			mid: mid,
			reaction: reaction,
		}).then(function (result) {
			app.parseAndTranslate('partials/reactions/users-list', {
				users: result.users,
				total: result.total,
				emojiHtml: $el.find('.emoji').first().prop('outerHTML') || '',
			}, function (html) {
				require(['modals'], function (modals) {
					modals.dialog({
						title: '[[reactions:users-who-reacted]]',
						message: html,
						onEscape: true,
						backdrop: true,
						buttons: {
							close: { label: '[[modules:bootbox.ok]]', className: 'btn-primary' },
						},
					});
				});
			});
		}).catch(function (err) {
			if (alerts) {
				alerts.error(err.message);
			}
		});
	}

	function setupPostReactions() {
		setupPostReactionSockets();

		$('[component="topic"]').off('click.reactions').on('click.reactions', '[component="post/reaction"]', function () {
			const reactionElement = $(this);
			const pid = reactionElement.attr('data-pid');
			const reaction = reactionElement.attr('data-reaction');
			const reacted = reactionElement.hasClass('reacted');
			if (!reacted && isOwnPost(reactionElement)) {
				return alerts.error('[[reactions:error.cannot-react-own-post]]');
			}
			const event = 'plugins.reactions.' + (reacted ? 'removePostReaction' : 'addPostReaction');
			socket.emit(event, {
				pid: pid,
				reaction: reaction,
			}, function (err) {
				if (err) {
					alerts.error(err.message);
				}
			});
		});

		$('[component="topic"]').off('click.reactionsAdd').on('click.reactionsAdd', '[component="post/reaction/add"]', function () {
			const reactionAddEl = $(this);
			if (isOwnPost(reactionAddEl)) {
				return;
			}
			const pid = reactionAddEl.attr('data-pid');
			const allowed = Array.isArray(config.allowedPostReactions) ? config.allowedPostReactions : [];

			function applyReaction(name) {
				socket.emit('plugins.reactions.addPostReaction', {
					pid: pid,
					reaction: name,
				}, function (err) {
					if (err) {
						alerts.error(err.message);
						throw err;
					}
					$('[component="post/reaction"][data-pid="' + pid + '"][data-reaction="' + name + '"]').addClass('reacted');
				});
			}

			if (allowed.length > 0) {
				openAllowedReactionsPicker(reactionAddEl, allowed, applyReaction);
			} else {
				require(['emoji-dialog'], function (emojiDialog) {
					emojiDialog.toggle(reactionAddEl[0], function (_, name, dialog) {
						emojiDialog.dialogActions.close(dialog);
						applyReaction(name);
					});
				});
			}
		});
	}

	function setupMessageReactions(container) {
		setupMessageReactionSockets();

		const messageContent = container.find('[component="chat/message/content"]');
		messageContent.on('click', '[component="message/reaction"]', function () {
			const reactionElement = $(this);
			const mid = reactionElement.attr('data-mid');
			const reaction = reactionElement.attr('data-reaction');
			const reacted = reactionElement.hasClass('reacted');
			const event = 'plugins.reactions.' + (reacted ? 'removeMessageReaction' : 'addMessageReaction');
			socket.emit(event, {
				mid: mid,
				reaction: reaction,
			}, function (err) {
				if (err) {
					alerts.error(err.message);
				}
			});
		});

		messageContent.on('click', '[component="message/reaction/add"]', function () {
			const reactionAddEl = $(this);
			const mid = reactionAddEl.attr('data-mid');

			require(['emoji-dialog'], function (emojiDialog) {
				emojiDialog.toggle(reactionAddEl[0], function (_, name, dialog) {
					emojiDialog.dialogActions.close(dialog);

					socket.emit('plugins.reactions.addMessageReaction', {
						mid: mid,
						reaction: name,
					}, function (err) {
						if (err) {
							return alerts.error(err.message);
						}

						$('[component="message/reaction"][data-mid="' + mid + '"][data-reaction="' + name + '"]').addClass('reacted');
					});
				});
			});
		});
	}

	function setupPostReactionSockets() {
		socket.off('event:reactions.addPostReaction').on('event:reactions.addPostReaction', function (data) {
			updatePostReactionCount(data, 'add');
		});

		socket.off('event:reactions.removePostReaction').on('event:reactions.removePostReaction', function (data) {
			updatePostReactionCount(data, 'remove');
		});
	}

	function setupMessageReactionSockets() {
		socket.off('event:reactions.addMessageReaction').on('event:reactions.addMessageReaction', function (data) {
			updateMessageReactionCount(data, 'add');
		});

		socket.off('event:reactions.removeMessageReaction').on('event:reactions.removeMessageReaction', function (data) {
			updateMessageReactionCount(data, 'remove');
		});
	}

	function updatePostReactionCount(data, type) {
		const maxReactionsReached = config.maximumReactions > 0 &&
			parseInt(data.totalReactions, 10) >= config.maximumReactions;
		$('[component="post/reaction/add"][data-pid="' + data.pid + '"]').toggleClass('max-reactions', maxReactionsReached);

		const reactionEl = $(`[component="post/reaction"][data-pid="${data.pid}"][data-reaction="${data.reaction}"]`);

		if (parseInt(data.reactionCount, 10) === 0) {
			reactionEl.tooltip('dispose');
			reactionEl.remove();
		}
		const isSelf = parseInt(data.uid, 10) === app.user.uid;
		if (reactionEl.length === 0) {
			app.parseAndTranslate('partials/topic/reaction', {
				pid: data.pid,
				reaction: data.reaction,
				reactionCount: data.reactionCount,
				usernames: data.usernames,
				reacted: isSelf && type === 'add',
				reactionImage: data.reactionImage,
			}, function (html) {
				$('[component="post/reactions"][data-pid="' + data.pid + '"]').prepend(html);
			});
		} else {
			reactionEl.find('.reaction-emoji-count').attr('data-count', data.reactionCount);
			reactionEl.attr('data-bs-original-title', data.usernames);
			reactionEl.attr('aria-label', data.usernames);
			if (isSelf) {
				reactionEl.toggleClass('reacted', type === 'add');
			}
		}
	}

	function updateMessageReactionCount(data, type) {
		const maxReactionsReached = config.maximumReactionsPerMessage > 0 &&
			parseInt(data.totalReactions, 10) >= config.maximumReactionsPerMessage;
		$('[component="message/reaction/add"][data-mid="' + data.mid + '"]').toggleClass('max-reactions', maxReactionsReached);

		const reactionEl = $(`[component="message/reaction"][data-mid="${data.mid}"][data-reaction="${data.reaction}"]`);

		if (parseInt(data.reactionCount, 10) === 0) {
			reactionEl.tooltip('dispose');
			reactionEl.remove();
		}
		const isSelf = (parseInt(data.uid, 10) === app.user.uid);
		if (reactionEl.length === 0) {
			app.parseAndTranslate('partials/chats/reaction', {
				mid: data.mid,
				reaction: data.reaction,
				reactionCount: data.reactionCount,
				reacted: isSelf && type === 'add',
				reactionImage: data.reactionImage,
			}, function (html) {
				require(['forum/chats/messages'], function (messages) {
					const reactionEl = $('[component="message/reactions"][data-mid="' + data.mid + '"]');
					const chatContentEl = reactionEl.parents('[component="chat/message/content"]');
					const isAtBottom = messages.isAtBottom(chatContentEl);
					reactionEl.append(html);
					if (isAtBottom) {
						messages.scrollToBottom(chatContentEl);
					}
				});
			});
		} else {
			reactionEl.find('.reaction-emoji-count').attr('data-count', data.reactionCount);
			reactionEl.attr('data-bs-original-title', data.usernames);
			reactionEl.attr('aria-label', data.usernames);
			if (isSelf) {
				reactionEl.toggleClass('reacted', type === 'add');
			}
		}
	}

	function createReactionTooltips() {
		require(['bootstrap', 'translator'], function (bootstrap, translator) {
			function disposeTooltip(el) {
				if (el && el.length) {
					const tooltip = bootstrap.Tooltip.getInstance(el.get(0));
					if (tooltip) {
						tooltip.dispose();
						el.attr('title', '');
					}
				}
			}
			async function getUsernamesText(data) {
				const usernames = data.usernames.filter(name => name !== '[[global:former_user]]');
				if (!usernames.length) {
					return '';
				}
				if (usernames.length + data.otherCount > data.cutoff) {
					return translator.translate(
						translator.compile('topic:users-and-others', usernames.join(', '), data.otherCount),
					);
				}
				return usernames.join(', ');
			}
			async function createTooltip(data) {
				const el = mouseOverReactionEl;
				disposeTooltip(el);
				const usernames = await getUsernamesText(data);
				if (!usernames) {
					return;
				}

				el.attr('title', usernames);
				(new bootstrap.Tooltip(el, {
					container: '#content',
					html: true,
					placement: 'top',
					animation: false,
				})).show();
			}
			function clearTooltipTimeout() {
				if (tooltipTimeoutId) {
					clearTimeout(tooltipTimeoutId);
					tooltipTimeoutId = 0;
				}
			}

			if (!utils.isTouchDevice()) {
				$('body').on('mouseenter', '.reaction', function () {
					const $this = $(this);
					mouseOverReactionEl = $this;
					clearTooltipTimeout();
					tooltipTimeoutId = setTimeout(async () => {
						if (mouseOverReactionEl && mouseOverReactionEl.length) {
							const pid = mouseOverReactionEl.attr('data-pid');
							const mid = mouseOverReactionEl.attr('data-mid');
							const reaction = mouseOverReactionEl.attr('data-reaction');
							const type = pid ? 'post' : 'message';
							const data = await socket.emit('plugins.reactions.getReactionUsernames', {
								type: type,
								mid: mid,
								pid: pid,
								reaction: reaction,
							});

							if (mouseOverReactionEl && mouseOverReactionEl.length &&
								reaction === mouseOverReactionEl.attr('data-reaction') &&
								(
									(type === 'post' && pid === mouseOverReactionEl.attr('data-pid')) ||
									(type === 'message' && mid === mouseOverReactionEl.attr('data-mid'))
								)
							) {
								createTooltip(data);
							}
						}
					}, 200);
				});
				$('body').on('mouseleave', '.reaction', function () {
					clearTooltipTimeout();
					mouseOverReactionEl = null;
					disposeTooltip($(this));
				});
				// right click = full list of users
				$('body').on('contextmenu', '.reaction', function (e) {
					e.preventDefault();
					clearTooltipTimeout();
					disposeTooltip($(this));
					openAllUsersModal($(this));
				});
			} else {
				setupLongPressUsersPopup(getUsernamesText, translator);
			}
		});
	}

	// Touch devices have no hover, so a long press on a reaction opens a popup with the
	// users who reacted. It stays open until the user taps somewhere else, so it survives
	// the browser's own long-press UI (e.g. the "image options" dialog) being opened and closed.
	function setupLongPressUsersPopup(getUsernamesText, translator) {
		const LONG_PRESS_MS = 450;
		const MOVE_TOLERANCE_PX = 10;
		const IGNORE_CLOSE_MS = 350;
		let usersPopupEl = null;
		let popupToken = 0;
		let longPressTimeoutId = 0;
		let longPressStart = null;
		let tapStart = null;
		let lastTouchStartTime = 0;
		let lastTouchEndTime = 0;
		let suppressNextClick = false;
		let popupRequested = false;

		function decodeEntities(str) {
			return new DOMParser().parseFromString(String(str), 'text/html').documentElement.textContent;
		}

		function clearLongPressTimeout() {
			if (longPressTimeoutId) {
				clearTimeout(longPressTimeoutId);
				longPressTimeoutId = 0;
			}
			longPressStart = null;
		}

		function closeUsersPopup() {
			popupToken += 1;
			popupRequested = false;
			tapStart = null;
			if (usersPopupEl) {
				usersPopupEl.remove();
				usersPopupEl = null;
			}
			$(document).off('.reactionsUsersPopup');
		}

		function positionUsersPopup($popup, $anchor) {
			const offset = $anchor.offset();
			const anchorCenter = offset.left + ($anchor.outerWidth() / 2);
			const popupW = $popup.outerWidth();
			const popupH = $popup.outerHeight();
			const winW = $(window).width();

			const left = Math.max(8, Math.min(anchorCenter - (popupW / 2), winW - popupW - 8));
			let top = offset.top - popupH - 8;
			const below = top < $(window).scrollTop() + 4;
			if (below) {
				top = offset.top + $anchor.outerHeight() + 8;
			}
			$popup.toggleClass('below', below);
			$popup.css({ top: top, left: left });
			$popup.find('.reactions-users-popup-arrow').css(
				'left',
				Math.max(10, Math.min(anchorCenter - left, popupW - 10)) + 'px',
			);
		}

		async function showUsersPopup($el) {
			const pid = $el.attr('data-pid');
			const mid = $el.attr('data-mid');
			const reaction = $el.attr('data-reaction');
			const type = pid ? 'post' : 'message';

			// the finger is still down (or just released): don't let it toggle the reaction
			suppressNextClick = true;
			closePopupAndReset();
			popupRequested = true;

			const token = popupToken;
			let data;
			try {
				data = await socket.emit('plugins.reactions.getReactionUsernames', {
					type: type,
					mid: mid,
					pid: pid,
					reaction: reaction,
				});
			} catch (err) {
				if (token === popupToken) {
					popupRequested = false;
					if (alerts) {
						alerts.error(err.message);
					}
				}
				return;
			}
			if (token !== popupToken) {
				return;
			}
			const text = await getUsernamesText(data);
			if (token !== popupToken) {
				return;
			}
			if (!text || !$el.closest('body').length) {
				popupRequested = false;
				return;
			}

			const $popup = $(
				'<div class="reactions-users-popup" role="tooltip">' +
				'<div class="reactions-users-popup-inner"></div>' +
				'<div class="reactions-users-popup-arrow"></div>' +
				'</div>'
			);
			$popup.find('.reactions-users-popup-inner').text(decodeEntities(text));
			if (data.otherCount > 0) {
				const label = await translator.translate('[[reactions:show-all-users]]');
				if (token !== popupToken) {
					return;
				}
				$('<a href="#" class="reactions-users-popup-all"></a>').text(label).appendTo(
					$popup.find('.reactions-users-popup-inner'),
				);
				$popup.on('click', '.reactions-users-popup-all', function (e) {
					e.preventDefault();
					e.stopPropagation();
					closePopupAndReset();
					openAllUsersModal($el);
				});
			}
			$('body').append($popup);
			positionUsersPopup($popup, $el);
			usersPopupEl = $popup;

			// Close only on a real tap (not a scroll) elsewhere. Listeners are attached a moment
			// later so the release of the long press itself can't close the popup.
			setTimeout(function () {
				if (token !== popupToken) {
					return;
				}
				tapStart = null;
				$(document).on('touchstart.reactionsUsersPopup', function (e) {
					const t = e.originalEvent.touches[0];
					tapStart = t ? { x: t.clientX, y: t.clientY } : null;
				});
				$(document).on('touchend.reactionsUsersPopup', function (e) {
					if ($(e.target).closest('.reactions-users-popup-all').length) {
						tapStart = null;
						return;
					}
					const t = e.originalEvent.changedTouches[0];
					if (tapStart && t &&
						Math.abs(t.clientX - tapStart.x) < MOVE_TOLERANCE_PX &&
						Math.abs(t.clientY - tapStart.y) < MOVE_TOLERANCE_PX) {
						closePopupAndReset();
					}
					tapStart = null;
				});
				// mouse / emulated mouse events (ignore the ones synthesized right after a touch)
				$(document).on('mousedown.reactionsUsersPopup', function (e) {
					if ($(e.target).closest('.reactions-users-popup-all').length) {
						return;
					}
					if (Date.now() - lastTouchEndTime > 700) {
						closePopupAndReset();
					}
				});
				$(document).on('keydown.reactionsUsersPopup', function (e) {
					if (e.key === 'Escape') {
						closePopupAndReset();
					}
				});
			}, IGNORE_CLOSE_MS);
		}

		function closePopupAndReset() {
			clearLongPressTimeout();
			closeUsersPopup();
		}

		// a new touch always starts clean
		document.addEventListener('touchstart', function () {
			lastTouchStartTime = Date.now();
			suppressNextClick = false;
		}, true);
		document.addEventListener('touchend', function () {
			lastTouchEndTime = Date.now();
		}, true);

		// swallow the click that the end of a long press may produce
		document.addEventListener('click', function (e) {
			if (suppressNextClick) {
				suppressNextClick = false;
				if (e.target.closest && e.target.closest('.reaction')) {
					e.preventDefault();
					e.stopPropagation();
				}
			}
		}, true);

		$('body').on('touchstart', '.reaction', function (e) {
			const t = e.originalEvent.touches[0];
			clearLongPressTimeout();
			if (!t || e.originalEvent.touches.length > 1) {
				return;
			}
			const $el = $(this);
			longPressStart = { x: t.clientX, y: t.clientY };
			longPressTimeoutId = setTimeout(function () {
				longPressTimeoutId = 0;
				showUsersPopup($el);
			}, LONG_PRESS_MS);
		});
		$('body').on('touchmove', '.reaction', function (e) {
			const t = e.originalEvent.touches[0];
			if (longPressStart && t &&
				(Math.abs(t.clientX - longPressStart.x) > MOVE_TOLERANCE_PX ||
				Math.abs(t.clientY - longPressStart.y) > MOVE_TOLERANCE_PX)) {
				clearLongPressTimeout();
			}
		});
		$('body').on('touchend touchcancel', '.reaction', clearLongPressTimeout);

		// On Android the long press fires "contextmenu" (the browser's image/link menu).
		// Treat it as the long-press signal and cancel the native menu where the browser allows it.
		$('body').on('contextmenu', '.reaction', function (e) {
			if (Date.now() - lastTouchStartTime > 1500) {
				return; // a real mouse right-click, leave it alone
			}
			e.preventDefault();
			clearLongPressTimeout();
			if (!popupRequested) {
				showUsersPopup($(this));
			}
		});
	}

	let openPickerEl = null;
	function closeOpenPicker() {
		if (openPickerEl) {
			openPickerEl.remove();
			openPickerEl = null;
			$(document).off('mousedown.reactionsPicker keydown.reactionsPicker');
		}
	}

	function openAllowedReactionsPicker(anchorEl, allowed, onPick) {
		closeOpenPicker();
		require(['emoji'], function (emoji) {
			emoji.init(function () {
				const $picker = $('<div class="reactions-allowed-picker"></div>');
				const $grid = $('<div class="reactions-allowed-grid"></div>');
				allowed.forEach(function (name) {
					const found = emoji.table[name];
					if (!found) return;
					const $btn = $('<button type="button" class="reactions-allowed-item" tabindex="0"></button>');
					$btn.attr('title', name);
					$btn.attr('data-reaction', name);
					$btn.html(emoji.buildEmoji(found));
					$btn.on('click', function (e) {
						e.preventDefault();
						e.stopPropagation();
						closeOpenPicker();
						onPick(name);
					});
					$grid.append($btn);
				});
				$picker.append($grid);
				$('body').append($picker);

				const offset = anchorEl.offset();
				const anchorH = anchorEl.outerHeight();
				const pickerW = $picker.outerWidth();
				const winW = $(window).width();
				let left = offset.left;
				if (left + pickerW > winW - 8) {
					left = Math.max(8, winW - pickerW - 8);
				}
				$picker.css({
					position: 'absolute',
					top: offset.top + anchorH + 4,
					left: left,
				});

				openPickerEl = $picker;

				setTimeout(function () {
					$(document).on('mousedown.reactionsPicker', function (ev) {
						if (!$(ev.target).closest('.reactions-allowed-picker').length &&
							!$(ev.target).closest(anchorEl).length) {
							closeOpenPicker();
						}
					});
					$(document).on('keydown.reactionsPicker', function (ev) {
						if (ev.key === 'Escape') closeOpenPicker();
					});
				}, 0);
			});
		});
	}
});
