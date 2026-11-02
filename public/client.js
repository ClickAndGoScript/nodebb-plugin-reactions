'use strict';

$(document).ready(function () {
	setupReactions();
	let alerts;
	let components;
	let mouseOverReactionEl;
	let tooltipTimeoutId = 0;
	function setupReactions() {
		createReactionTooltips();
		require(['hooks', 'alerts', 'components'], function (hooks, _alerts, _components) {
			alerts = _alerts;
			components = _components;
			setupLifecycleSockets();
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
	}

	function setupLifecycleSockets() {
		socket.on('event:post_deleted', function (data) {
			components.get('post', 'pid', data.pid).find('[component="post/reaction/add"]').addClass('hidden');
		});

		socket.on('event:post_restored', function (data) {
			components.get('post', 'pid', data.pid).find('[component="post/reaction/add"]').removeClass('hidden');
		});

		socket.on('event:chats.delete', function (mid) {
			components.get('chat/message', mid).find('[component="message/reactions"]').addClass('hidden');
		});

		socket.on('event:chats.restore', function (msg) {
			components.get('chat/message', msg.mid).find('[component="message/reactions"]').removeClass('hidden');
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
		components.get('post/reaction/add').each(function () {
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
			require(['modals', 'benchpress'], async function (modals, Benchpress) {
				const html = await Benchpress.render('partials/reactions/users-list', result);
				const dialog = await modals.dialog({
					title: '[[reactions:users-who-reacted]]',
					message: html,
					className: 'reaction-users-modal',
					show: true,
					onEscape: true,
					backdrop: true,
				});

				dialog.on('click', function () {
					dialog.modal('hide');
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

		components.get('topic').off('click.reactions').on('click.reactions', '[component="post/reaction"]', function () {
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

		components.get('topic').off('click.reactionsAdd').on(
			'click.reactionsAdd', '[component="post/reaction/add"]', function () {
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
						components.get('post', 'pid', pid)
							.find('[component="post/reaction"][data-reaction="' + name + '"]')
							.addClass('reacted');
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
			}
		);
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

						components.get('chat/message', mid)
							.find('[component="message/reaction"][data-reaction="' + name + '"]')
							.addClass('reacted');
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
		components.get('post', 'pid', data.pid)
			.find('[component="post/reaction/add"]')
			.toggleClass('max-reactions', maxReactionsReached);

		const postEl = components.get('post', 'pid', data.pid);
		const reactionEl = postEl.find(`[component="post/reaction"][data-reaction="${data.reaction}"]`);

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
				postEl.find('[component="post/reactions"]').prepend(html);
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
		const messageEl = components.get('chat/message', data.mid);
		messageEl.find('[component="message/reaction/add"]').toggleClass('max-reactions', maxReactionsReached);
		const reactionEl = messageEl.find(`[component="message/reaction"][data-reaction="${data.reaction}"]`);

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
					const reactionEl = messageEl.find('[component="message/reactions"]');
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
			async function createTooltip(data) {
				const el = mouseOverReactionEl;
				disposeTooltip(el);
				const usernames = data.usernames.filter(name => name !== '[[global:former-user]]');
				if (!usernames.length) {
					return;
				}
				const usersList = usernames.join(', ');
				const title = usernames.length + data.otherCount > data.cutoff ?
					await translator.translateKey('topic:users-and-others', [usersList, data.otherCount]) :
					utils.escapeHTML(usersList);

				el.attr('title', title);
				(new bootstrap.Tooltip(el, {
					container: '#content',
					html: true,
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
				setupLongPressUsersModal();
			}
		});
	}

	// NodeBB has no shared long-press helper. Keep gesture detection small and hand the UI
	// off to its standard modal component, as core does for full voter lists.
	function setupLongPressUsersModal() {
		const LONG_PRESS_MS = 450;
		const MOVE_TOLERANCE_PX = 10;
		let longPressTimeoutId = 0;
		let longPressStart = null;
		let lastTouchStartTime = 0;
		let suppressNextClick = false;
		let longPressHandled = false;

		function clearLongPressTimeout() {
			if (longPressTimeoutId) {
				clearTimeout(longPressTimeoutId);
				longPressTimeoutId = 0;
			}
			longPressStart = null;
		}

		function showUsersModal($el) {
			if (longPressHandled) {
				return;
			}
			longPressHandled = true;
			suppressNextClick = true;
			clearLongPressTimeout();
			openAllUsersModal($el);
		}

		document.addEventListener('touchstart', function () {
			lastTouchStartTime = Date.now();
			suppressNextClick = false;
			longPressHandled = false;
		}, true);

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
				showUsersModal($el);
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

		$('body').on('contextmenu', '.reaction', function (e) {
			if (Date.now() - lastTouchStartTime > 1500) {
				return;
			}
			e.preventDefault();
			clearLongPressTimeout();
			showUsersModal($(this));
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
					// nodebb-plugin-emoji with localized names (emoji.localizedName): "<local name> · <name>"
					const local = typeof emoji.localizedName === 'function' ? emoji.localizedName(found) : '';
					$btn.attr('title', local ? `${local} · ${name}` : name);
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
