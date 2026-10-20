'use strict';

// Adds the "delete the notification when the built-in upvote is removed" switch to the
// forum settings page (Settings > Reputation & Flags). It is saved by the core settings page
// as the config key `reactions:deleteNotificationOnUnvote`.
$(document).ready(function () {
	const KEY = 'reactions:deleteNotificationOnUnvote';

	require(['hooks', 'translator'], function (hooks, translator) {
		hooks.on('action:admin.settingsLoaded', function () {
			const $container = $('#reputation-settings');
			if (!$container.length || $container.find('[data-field="' + KEY + '"]').length) {
				return;
			}

			const stored = app.config && app.config[KEY];
			const enabled = stored === undefined || stored === null || stored === '' ?
				true :
				!(String(stored) === '0' || String(stored) === 'false' || String(stored) === 'off');

			Promise.all([
				translator.translate('[[reactions:settings.delete-notification-on-unvote]]'),
				translator.translate('[[reactions:settings.delete-notification-on-unvote-help]]'),
			]).then(function (texts) {
				if ($container.find('[data-field="' + KEY + '"]').length) {
					return;
				}
				const $item = $(
					'<div class="form-check form-switch mb-3">' +
						'<input type="checkbox" class="form-check-input" id="' + KEY + '" data-field="' + KEY + '">' +
						'<label for="' + KEY + '" class="form-check-label"></label>' +
						'<p class="form-text"></p>' +
					'</div>'
				);
				$item.find('label').text(texts[0]);
				$item.find('p').text(texts[1]);
				$item.find('input').prop('checked', enabled).on('change', function () {
					app.flags = app.flags || {};
					app.flags._unsaved = true;
				});
				$container.append($item);
			});
		});
	});
});
