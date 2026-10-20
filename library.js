'use strict';

const meta = nodebb.require('./src/meta');
const user = nodebb.require('./src/user');
const posts = nodebb.require('./src/posts');
const topics = nodebb.require('./src/topics');
const messaging = nodebb.require('./src/messaging');
const privileges = nodebb.require('./src/privileges');
const db = nodebb.require('./src/database');
const translator = nodebb.require('./src/translator');
const notifications = nodebb.require('./src/notifications');
const routesHelpers = nodebb.require('./src/routes/helpers');
const websockets = nodebb.require('./src/socket.io/index');
const SocketPlugins = nodebb.require('./src/socket.io/plugins');

const emojiParser = nodebb.require('nodebb-plugin-emoji/build/lib/parse.js');

let emojiTable = null;
let emojiAliases = null;

const DEFAULT_MAX_EMOTES = 4;
const POST_MERGE_ID = 'reactions-post';
const MESSAGE_MERGE_ID = 'reactions-message';
const MAX_USERS_IN_FULL_LIST = 200;

function nameToEmoji(name) {
	if (!emojiTable) {
		emojiTable = nodebb.require('nodebb-plugin-emoji/build/emoji/table.json');
	}
	return emojiTable[name];
}

function parse(name) {
	if (!emojiAliases) {
		emojiAliases = nodebb.require('nodebb-plugin-emoji/build/emoji/aliases.json');
	}
	const emoji = nameToEmoji(name) || emojiTable[emojiAliases[name]];
	return emoji ? emojiParser.buildEmoji(emoji, '') : '';
}

const ReactionsPlugin = module.exports;

ReactionsPlugin.init = async function (params) {
	routesHelpers.setupAdminPageRoute(params.router, '/admin/plugins/reactions', (req, res) => {
		res.render('admin/plugins/reactions', {
			title: '[[reactions:reactions]]',
		});
	});
};

ReactionsPlugin.addAdminNavigation = async function (header) {
	header.plugins.push({
		route: '/plugins/reactions',
		icon: 'fa-paint-brush',
		name: '[[reactions:reactions]]',
	});
	return header;
};

ReactionsPlugin.getPluginConfig = async function (config) {
	const settings = await loadPluginConfig();
	config.maximumReactions = settings.maximumReactions;
	config.maximumReactionsPerUserPerPost = settings.maximumReactionsPerUserPerPost;
	config.maximumReactionsPerMessage = settings.maximumReactionsPerMessage;
	config.maximumReactionsPerUserPerMessage = settings.maximumReactionsPerUserPerMessage;

	config.enablePostReactions = settings.enablePostReactions;
	config.allowSelfReactions = settings.allowSelfReactions;
	config.enableMessageReactions = settings.enableMessageReactions;
	config.allowedPostReactions = settings.allowedPostReactions;
	return config;
};

async function loadPluginConfig() {
	const settings = await meta.settings.get('reactions');
	function parseNum(val, defaultValue) {
		const parsed = parseInt(val, 10);
		return Number.isNaN(parsed) ? defaultValue : parsed;
	}
	// posts
	settings.maximumReactions = parseNum(settings.maximumReactions, DEFAULT_MAX_EMOTES);
	settings.maximumReactionsPerUserPerPost = parseNum(settings.maximumReactionsPerUserPerPost, 0);

	// chats
	settings.maximumReactionsPerMessage = parseNum(settings.maximumReactionsPerMessage, DEFAULT_MAX_EMOTES);
	settings.maximumReactionsPerUserPerMessage = parseNum(settings.maximumReactionsPerUserPerMessage, 0);

	settings.enablePostReactions = settings.enablePostReactions === 'on';
	settings.enableMessageReactions = settings.enableMessageReactions === 'on';
	settings.allowSelfReactions = settings.allowSelfReactions === 'on';
	// absent = on (previous behaviour); only an explicit 'off' disables them
	settings.deleteNotificationOnRemove = settings.deleteNotificationOnRemove !== 'off';
	settings.deleteNotificationOnUnvote = settings.deleteNotificationOnUnvote !== 'off';
	settings.allowedPostReactions = Array.isArray(settings['allowed-post-reactions']) ?
		settings['allowed-post-reactions'].map(r => r && r.reaction).filter(Boolean) : [];
	return settings;
}

ReactionsPlugin.filterSettingsGet = async function (hookData) {
	if (hookData.plugin === 'reactions') {
		const { values } = hookData;
		if (!values.hasOwnProperty('enablePostReactions')) {
			values.enablePostReactions = 'on';
		}
		if (!values.hasOwnProperty('enableMessageReactions')) {
			values.enableMessageReactions = 'on';
		}
		if (!values.hasOwnProperty('deleteNotificationOnRemove')) {
			values.deleteNotificationOnRemove = 'on';
		}
		if (!values.hasOwnProperty('deleteNotificationOnUnvote')) {
			values.deleteNotificationOnUnvote = 'on';
		}
	}
	return hookData;
};

// Several users reacting with the SAME emoji to the same post / message become one notification:
// "A and 3 others have reacted with :smile: to your post in <topic>".
// Different emojis on the same post stay separate notifications.
ReactionsPlugin.mergeReactionNotifications = async function (data) {
	if (!data || !Array.isArray(data.notifications)) {
		return data;
	}
	const groups = new Map(); // `${mergeId}::${emoji}` -> notifications (only the same emoji on the same post/message is merged)
	data.notifications.forEach((notif) => {
		if (notif && notif.type === 'reaction' && typeof notif.mergeId === 'string' &&
			(notif.mergeId.startsWith(`${POST_MERGE_ID}:`) || notif.mergeId.startsWith(`${MESSAGE_MERGE_ID}:`))) {
			const groupKey = `${notif.mergeId}::${notif.reaction || ''}`;
			if (!groups.has(groupKey)) {
				groups.set(groupKey, []);
			}
			groups.get(groupKey).push(notif);
		}
	});

	const removed = new Set();
	groups.forEach((set) => {
		if (set.length <= 1) {
			return;
		}
		const target = set[0];
		const names = [...new Set(set.map(n => n.user && n.user.displayname).filter(Boolean))]
			.map(name => translator.escape(name));
		if (!names.length) {
			return;
		}
		const emojis = [...new Set(set.map(n => n.reaction).filter(Boolean))]
			.slice(0, 5).map(name => `:${name}:`).join(' ');
		const isPost = set[0].mergeId.startsWith(`${POST_MERGE_ID}:`);
		const where = isPost ?
			[target.topicTitle] :
			[target.roomIcon, translator.escape(target.roomName || '')];
		const baseKey = isPost ?
			'reactions:notification.user-has-reacted-to-your-post-in-topic' :
			'reactions:notification.user-has-reacted-to-your-message-in-room';

		let key = baseKey;
		let args = [names[0], emojis, ...where];
		if (names.length === 2) {
			key = `${baseKey}-two`;
			args = [names[0], names[1], emojis, ...where];
		} else if (names.length > 2) {
			key = `${baseKey}-multiple`;
			args = [names[0], names.length - 1, emojis, ...where];
		}
		target.bodyShort = translator.compile(key, ...args);
		target.mergeCount = set.length;
		set.slice(1).forEach(n => removed.add(n));
	});
	if (removed.size) {
		data.notifications = data.notifications.filter(n => !removed.has(n));
	}
	return data;
};

// The forum's built-in upvote ("like", not our emoji reactions): when the voter takes the upvote back
// (or switches it to a downvote), NodeBB core fires action:post.unvote but keeps the notification.
// Core's notification id for it is `upvote:post:<pid>:uid:<voter>`.
ReactionsPlugin.onUnvote = async function (data) {
	try {
		if (!data || data.current !== 'upvote' || !data.pid || !data.uid) {
			return;
		}
		const settings = await loadPluginConfig();
		if (!settings.deleteNotificationOnUnvote) {
			return;
		}
		await notifications.rescind(`upvote:post:${data.pid}:uid:${data.uid}`);
	} catch (e) {
		console.error(e);
	}
};

// Notification texts are stored with ":name:" shortcodes. After NodeBB translated them, swap the shortcodes
// for the real emoji image (the HTML cannot travel through translator arguments, they are escaped).
ReactionsPlugin.renderNotificationEmojis = async function (data) {
	if (!data || !Array.isArray(data.notifications)) {
		return data;
	}
	data.notifications.forEach((notif) => {
		if (notif && notif.type === 'reaction' && typeof notif.bodyShort === 'string') {
			try {
				notif.bodyShort = notif.bodyShort.replace(/:([a-z0-9_+-]+):/gi, (whole, name) => {
					const html = parse(name.toLowerCase());
					return html || whole;
				});
			} catch (e) {
				console.error(e);
			}
		}
	});
	return data;
};

ReactionsPlugin.addNotificationFilters = async (data) => {
	data.regularFilters.push({ name: '[[reactions:reactions]]', filter: 'reaction' });
	return data;
};

ReactionsPlugin.notificationTypes = async (data) => {
	data.types.push('notificationType_reaction');
	return data;
};

ReactionsPlugin.getPostReactions = async function (data) {
	if (data.uid === 0) {
		return data;
	}

	try {
		const settings = await loadPluginConfig();
		if (!settings.enablePostReactions) {
			return data;
		}
		const { maximumReactions } = settings;

		const pids = data.posts.map(post => post && parseInt(post.pid, 10));
		const allReactionsForPids = await db.getSetsMembers(pids.map(pid => `pid:${pid}:reactions`));

		const pidToIsMaxReactionsReachedMap = new Map(); // pid -> IsMaxReactionsReached (boolean)
		const pidToReactionsMap = new Map(); // pid -> reactions (string[])
		let reactionSets = [];

		for (let i = 0, len = pids.length; i < len; i++) {
			try {
				const pid = pids[i];
				const reactionsList = allReactionsForPids[i];
				const reactionsCount = reactionsList.length;

				if (reactionsList && reactionsList.length > 0) {
					pidToReactionsMap.set(pid, reactionsList);
					pidToIsMaxReactionsReachedMap.set(pid, maximumReactions > 0 && reactionsCount >= maximumReactions);
					reactionSets = reactionSets.concat(reactionsList.map(reaction => `pid:${pid}:reaction:${reaction}`));
				}
			} catch (e) {
				console.error(e);
			}
		}

		const reactionSetToUsersMap = await getReactionSetsUidsMap(reactionSets);

		for (const post of data.posts) {
			if (post) {
				post.maxReactionsReached = pidToIsMaxReactionsReachedMap.get(post.pid);
				post.reactions = [];

				const reactions = pidToReactionsMap.get(post.pid);
				if (reactions) {
					for (const reaction of reactions) {
						const reactionSet = `pid:${post.pid}:reaction:${reaction}`;
						const uids = reactionSetToUsersMap.get(reactionSet);
						const reactionImage = parse(reaction);
						if (Array.isArray(uids) && reactionImage) {
							post.reactions.push({
								pid: post.pid,
								reacted: uids.includes(String(data.uid)),
								reaction,
								reactionImage: reactionImage,
								reactionCount: uids.length,
							});
						}
					}
				}
			}
		}
	} catch (e) {
		console.error(e);
	}
	return data;
};

ReactionsPlugin.getMessageReactions = async function (data) {
	if (data.uid === 0) {
		return data;
	}

	try {
		const settings = await loadPluginConfig();
		if (!settings.enableMessageReactions) {
			return data;
		}
		const { maximumReactionsPerMessage } = settings;

		const mids = data.messages.map(message => message && parseInt(message.mid, 10));
		const allReactionsForMids = await db.getSetsMembers(mids.map(mid => `mid:${mid}:reactions`));

		const midToIsMaxReactionsReachedMap = new Map(); // mid -> IsMaxReactionsReached (boolean)
		const midToReactionsMap = new Map(); // mid -> reactions (string[])
		let reactionSets = [];

		for (let i = 0, len = mids.length; i < len; i++) {
			const mid = mids[i];
			const reactionsList = allReactionsForMids[i];
			const reactionsCount = reactionsList.length;

			if (reactionsList && reactionsList.length > 0) {
				midToReactionsMap.set(mid, reactionsList);
				midToIsMaxReactionsReachedMap.set(
					mid,
					maximumReactionsPerMessage > 0 && reactionsCount >= maximumReactionsPerMessage
				);
				reactionSets = reactionSets.concat(reactionsList.map(reaction => `mid:${mid}:reaction:${reaction}`));
			}
		}

		const reactionSetToUsersMap = await getReactionSetsUidsMap(reactionSets);

		for (const msg of data.messages) {
			if (msg) {
				msg.maxReactionsReached = midToIsMaxReactionsReachedMap.get(msg.mid);
				msg.reactions = [];
				const reactions = midToReactionsMap.get(msg.mid);
				if (reactions) {
					for (const reaction of reactions) {
						const reactionSet = `mid:${msg.mid}:reaction:${reaction}`;
						const uids = reactionSetToUsersMap.get(reactionSet);
						const reactionImage = parse(reaction);
						if (Array.isArray(uids) && reactionImage) {
							msg.reactions.push({
								mid: msg.mid,
								reacted: uids.includes(String(data.uid)),
								reaction,
								reactionImage: reactionImage,
								reactionCount: uids.length,
							});
						}
					}
				}
			}
		}
	} catch (e) {
		console.error(e);
	}
	return data;
};


async function getReactionSetsUidsMap(reactionSets) {
	const reactionSetToUsersMap = new Map(); // reactionSet -> uids
	if (reactionSets.length > 0) {
		const uidsForReactions = await db.getSetsMembers(reactionSets);

		for (let i = 0, len = reactionSets.length; i < len; i++) {
			const uidsForReaction = uidsForReactions[i];
			if (uidsForReaction && uidsForReaction.length > 0) {
				reactionSetToUsersMap.set(reactionSets[i], uidsForReaction);
			}
		}
	}
	return reactionSetToUsersMap;
}

ReactionsPlugin.onReply = async function (data) {
	if (data.uid !== 0) {
		data.reactions = [];
	}
	return data;
};

ReactionsPlugin.deleteReactions = async function (hookData) {
	const pids = hookData.posts.map(post => post && post.pid);
	const pidsReactions = await db.getSetsMembers(pids.map(pid => `pid:${pid}:reactions`));

	const keys = [];
	pidsReactions.forEach((reactions, index) => {
		keys.push(
			...reactions.map(reaction => `pid:${pids[index]}:reaction:${reaction}`),
			`pid:${pids[index]}:reactions`,
		);
	});

	await db.deleteAll(keys);
};

async function sendPostEvent(data, eventName) {
	try {
		const [reactionCount, totalReactions] = await Promise.all([
			db.setCount(`pid:${data.pid}:reaction:${data.reaction}`),
			db.setCount(`pid:${data.pid}:reactions`),
		]);

		if (parseInt(reactionCount, 10) === 0) {
			await db.setRemove(`pid:${data.pid}:reactions`, data.reaction);
		}

		await websockets.in(`topic_${data.tid}`).emit(eventName, {
			pid: data.pid,
			uid: data.uid,
			reaction: data.reaction,
			reactionCount,
			totalReactions,
			reactionImage: parse(data.reaction),
		});
	} catch (e) {
		console.error(e);
	}
}

async function sendMessageEvent(data, eventName) {
	try {
		const [reactionCount, totalReactions] = await Promise.all([
			db.setCount(`mid:${data.mid}:reaction:${data.reaction}`),
			db.setCount(`mid:${data.mid}:reactions`),
		]);

		if (parseInt(reactionCount, 10) === 0) {
			await db.setRemove(`mid:${data.mid}:reactions`, data.reaction);
		}

		await websockets.in(`chat_room_${data.roomId}`).emit(eventName, {
			mid: data.mid,
			uid: data.uid,
			reaction: data.reaction,
			reactionCount,
			totalReactions,
			reactionImage: parse(data.reaction),
		});
	} catch (e) {
		console.error(e);
	}
}

async function getReactionReputation(reaction) {
	const settings = await meta.settings.get('reactions');
	const reactionsReps = settings['reaction-reputations'] || [];
	const foundReaction = reactionsReps.find(r => r.reaction === reaction);
	return foundReaction ? parseInt(foundReaction.reputation, 10) || 0 : 0;
}

async function giveOwnerReactionReputation(reactionReputation, pid) {
	const ownerUid = await posts.getPostField(pid, 'uid');
	if (parseInt(ownerUid, 10) > 0) {
		await user.incrementUserReputationBy(ownerUid, reactionReputation);
	}
}

// When a user takes back a reaction, the notification that was sent to the author is deleted too.
// Failing to delete it must never make removing the reaction itself fail.
async function rescindReactionNotification(nid, enabled = true) {
	if (!enabled) {
		return;
	}
	try {
		await notifications.rescind(nid);
	} catch (e) {
		console.error(e);
	}
}

async function getReactionSetKey(socket, data) {
	if (!socket.uid) {
		throw new Error('[[error:not-logged-in]]');
	}
	if (!nameToEmoji(data.reaction)) {
		throw new Error('[[reactions:error.invalid-reaction]]');
	}
	if (data.type === 'post') {
		if (!await privileges.posts.can('topics:read', data.pid, socket.uid)) {
			throw new Error('[[error:not-allowed]]');
		}
		return `pid:${data.pid}:reaction:${data.reaction}`;
	} else if (data.type === 'message') {
		const roomId = await messaging.getMessageField(data.mid, 'roomId');
		if (!await messaging.canViewMessage(data.mid, roomId, socket.uid)) {
			throw new Error('[[error:not-allowed]]');
		}
		return `mid:${data.mid}:reaction:${data.reaction}`;
	}
	throw new Error('[[error:invalid-data]]');
}

SocketPlugins.reactions = {
	addPostReaction: async function (socket, data) {
		if (!socket.uid) {
			throw new Error('[[error:not-logged-in]]');
		}

		if (!nameToEmoji(data.reaction)) {
			throw new Error('[[reactions:error.invalid-reaction]]');
		}

		const settings = await loadPluginConfig();
		if (!settings.enablePostReactions) {
			throw new Error('[[error:post-reactions-disabled]]');
		}
		if (settings.allowedPostReactions.length > 0 && !settings.allowedPostReactions.includes(data.reaction)) {
			throw new Error('[[reactions:error.reaction-not-allowed]]');
		}
		const [postData, totalReactions, emojiIsAlreadyExist, alreadyReacted, reactionReputation] = await Promise.all([
			posts.getPostFields(data.pid, ['pid', 'tid', 'uid', 'content', 'sourceContent', 'deleted']),
			db.setCount(`pid:${data.pid}:reactions`),
			db.isSetMember(`pid:${data.pid}:reactions`, data.reaction),
			db.isSetMember(`pid:${data.pid}:reaction:${data.reaction}`, socket.uid),
			getReactionReputation(data.reaction),
		]);
		const { tid } = postData;
		if (!tid) {
			throw new Error('[[error:no-post]]');
		}
		if (postData.deleted) {
			throw new Error('[[reactions:error.post-deleted]]');
		}
		const isOwnPost = parseInt(postData.uid, 10) === parseInt(socket.uid, 10);
		if (isOwnPost && !settings.allowSelfReactions) {
			throw new Error('[[reactions:error.cannot-react-own-post]]');
		}
		data.uid = socket.uid;
		data.tid = tid;
		if (!emojiIsAlreadyExist) {
			const { maximumReactions, maximumReactionsPerUserPerPost } = settings;
			if (maximumReactions > 0 && totalReactions >= maximumReactions) {
				throw new Error(`[[reactions:error.maximum-reached, ${maximumReactions}]]`);
			}

			if (maximumReactionsPerUserPerPost > 0) {
				const emojiesInPost = await db.getSetMembers(`pid:${data.pid}:reactions`);
				const userPostReactions = await db.isMemberOfSets(emojiesInPost.map(emojiName => `pid:${data.pid}:reaction:${emojiName}`), socket.uid);
				const userPostReactionCount = userPostReactions.filter(Boolean).length;
				if (userPostReactionCount >= maximumReactionsPerUserPerPost) {
					throw new Error(`[[reactions:error.maximum-per-user-per-post-reached, ${maximumReactionsPerUserPerPost}]]`);
				}
			}
		}

		await Promise.all([
			db.setAdd(`pid:${data.pid}:reactions`, data.reaction),
			db.setAdd(`pid:${data.pid}:reaction:${data.reaction}`, socket.uid),
		]);

		if (!alreadyReacted && reactionReputation > 0 && !isOwnPost) {
			await giveOwnerReactionReputation(reactionReputation, data.pid);
		}

		if (postData.uid && postData.uid !== socket.uid) {
			const [displayname, topicTitle, parsedPostData] = await Promise.all([
				user.getNotificationDisplayname(socket.uid),
				topics.getNotificationTitle(data.tid),
				posts.parsePost(postData),
			]);
			const notifObj = await notifications.create({
				type: 'reaction',
				bodyShort: translator.compile(
					'reactions:notification.user-has-reacted-with-to-your-post-in-topic',
					displayname,
					`:${data.reaction}:`,
					topicTitle
				),
				bodyLong: parsedPostData.content,
				nid: `uid:${socket.uid}:pid:${data.pid}:reaction:${data.reaction}`,
				mergeId: `${POST_MERGE_ID}:${data.pid}:${data.reaction}`,
				reaction: data.reaction,
				topicTitle: topicTitle,
				pid: data.pid,
				tid: data.tid,
				from: socket.uid,
				path: `/post/${data.pid}`,
			});

			await notifications.push(notifObj, [postData.uid]);
		}

		await sendPostEvent(data, 'event:reactions.addPostReaction');
	},
	removePostReaction: async function (socket, data) {
		if (!socket.uid) {
			throw new Error('[[error:not-logged-in]]');
		}

		if (!nameToEmoji(data.reaction)) {
			throw new Error('[[reactions:error.invalid-reaction]]');
		}

		const [settings, postFields, hasReacted, reactionReputation] = await Promise.all([
			loadPluginConfig(),
			posts.getPostFields(data.pid, ['tid', 'uid', 'deleted']),
			db.isSetMember(`pid:${data.pid}:reaction:${data.reaction}`, socket.uid),
			getReactionReputation(data.reaction),
		]);
		const { tid } = postFields;
		if (!settings.enablePostReactions) {
			throw new Error('[[error:post-reactions-disabled]]');
		}
		if (!tid) {
			throw new Error('[[error:no-post]]');
		}
		if (postFields.deleted) {
			throw new Error('[[reactions:error.post-deleted]]');
		}
		data.uid = socket.uid;
		data.tid = tid;

		if (hasReacted) {
			await db.setRemove(`pid:${data.pid}:reaction:${data.reaction}`, socket.uid);
			await rescindReactionNotification(
				`uid:${socket.uid}:pid:${data.pid}:reaction:${data.reaction}`,
				settings.deleteNotificationOnRemove
			);
		}

		const reactionCount = await db.setCount(`pid:${data.pid}:reaction:${data.reaction}`);
		if (reactionCount === 0) {
			await db.setRemove(`pid:${data.pid}:reactions`, data.reaction);
		}
		if (hasReacted && reactionReputation > 0 && parseInt(postFields.uid, 10) !== parseInt(socket.uid, 10)) {
			await giveOwnerReactionReputation(-reactionReputation, data.pid);
		}

		await sendPostEvent(data, 'event:reactions.removePostReaction');
	},
	addMessageReaction: async function (socket, data) {
		if (!socket.uid) {
			throw new Error('[[error:not-logged-in]]');
		}

		if (!nameToEmoji(data.reaction)) {
			throw new Error('[[reactions:error.invalid-reaction]]');
		}

		const settings = await loadPluginConfig();
		if (!settings.enableMessageReactions) {
			throw new Error('[[error:message-reactions-disabled]]');
		}

		const [msgData, totalReactions, emojiIsAlreadyExist] = await Promise.all([
			messaging.getMessageFields(data.mid, ['roomId', 'fromuid', 'content']),
			db.setCount(`mid:${data.mid}:reactions`),
			db.isSetMember(`mid:${data.mid}:reactions`, data.reaction),
		]);
		const { roomId } = msgData;
		if (!roomId) {
			throw new Error('[[error:no-message]]');
		}

		data.uid = socket.uid;
		data.roomId = roomId;

		if (!emojiIsAlreadyExist) {
			const { maximumReactionsPerMessage, maximumReactionsPerUserPerMessage } = settings;
			if (maximumReactionsPerMessage > 0 && totalReactions >= maximumReactionsPerMessage) {
				throw new Error(`[[reactions:error.maximum-reached, ${maximumReactionsPerMessage}]]`);
			}

			if (maximumReactionsPerUserPerMessage > 0) {
				const emojiesInMessage = await db.getSetMembers(`mid:${data.mid}:reactions`);
				const userPostReactions = await db.isMemberOfSets(emojiesInMessage.map(emojiName => `mid:${data.mid}:reaction:${emojiName}`), socket.uid);
				const userPostReactionCount = userPostReactions.filter(Boolean).length;
				if (userPostReactionCount >= maximumReactionsPerUserPerMessage) {
					throw new Error(`[[reactions:error.maximum-per-user-per-message-reached, ${maximumReactionsPerUserPerMessage}]]`);
				}
			}
		}

		await Promise.all([
			db.setAdd(`mid:${data.mid}:reactions`, data.reaction),
			db.setAdd(`mid:${data.mid}:reaction:${data.reaction}`, socket.uid),
		]);

		if (msgData.fromuid && msgData.fromuid !== socket.uid) {
			const [userData, roomData, parsedMessage] = await Promise.all([
				user.getUserFields(socket.uid, ['username', 'userslug', 'fullname']),
				messaging.getRoomData(roomId),
				messaging.parse(msgData.content, socket.uid, msgData.fromuid, roomId, false),
			]);
			const roomName = roomData.roomName || `[[modules:chat.room-id, ${roomId}]]`;
			const icon = messaging.getRoomIcon(roomData);

			const notifObj = await notifications.create({
				type: 'reaction',
				bodyShort: translator.compile(
					'reactions:notification.user-has-reacted-with-to-your-message-in-room',
					userData.displayname,
					`:${data.reaction}:`,
					icon,
					roomName
				),
				bodyLong: parsedMessage,
				roomIcon: icon,
				nid: `uid:${socket.uid}:mid:${data.mid}:reaction:${data.reaction}`,
				mergeId: `${MESSAGE_MERGE_ID}:${data.mid}:${data.reaction}`,
				reaction: data.reaction,
				roomName: roomName,
				mid: data.mid,
				roomId: roomId,
				from: socket.uid,
				path: `/message/${data.mid}`,
			});

			await notifications.push(notifObj, [msgData.fromuid]);
		}

		await sendMessageEvent(data, 'event:reactions.addMessageReaction');
	},
	removeMessageReaction: async function (socket, data) {
		if (!socket.uid) {
			throw new Error('[[error:not-logged-in]]');
		}

		if (!nameToEmoji(data.reaction)) {
			throw new Error('[[reactions:error.invalid-reaction]]');
		}

		const [settings, roomId, hasReacted] = await Promise.all([
			loadPluginConfig(),
			messaging.getMessageField(data.mid, 'roomId'),
			db.isSetMember(`mid:${data.mid}:reaction:${data.reaction}`, socket.uid),
		]);
		if (!settings.enableMessageReactions) {
			throw new Error('[[error:message-reactions-disabled]]');
		}
		if (!roomId) {
			throw new Error('[[error:no-message]]');
		}
		data.uid = socket.uid;
		data.roomId = roomId;
		if (hasReacted) {
			await db.setRemove(`mid:${data.mid}:reaction:${data.reaction}`, socket.uid);
			await rescindReactionNotification(
				`uid:${socket.uid}:mid:${data.mid}:reaction:${data.reaction}`,
				settings.deleteNotificationOnRemove
			);
		}

		const reactionCount = await db.setCount(`mid:${data.mid}:reaction:${data.reaction}`);
		if (reactionCount === 0) {
			await db.setRemove(`mid:${data.mid}:reactions`, data.reaction);
		}

		await sendMessageEvent(data, 'event:reactions.removeMessageReaction');
	},
	getReactionUsernames: async function (socket, data) {
		const set = await getReactionSetKey(socket, data);
		let uids = await db.getSetMembers(set);
		const cutoff = 6;

		let otherCount = 0;
		if (uids.length > cutoff) {
			otherCount = uids.length - (cutoff - 1);
			uids = uids.slice(0, cutoff - 1);
		}

		const usernames = await user.getUsernamesByUids(uids);
		return {
			cutoff: cutoff,
			otherCount,
			usernames,
		};
	},
	getReactionUsers: async function (socket, data) {
		const set = await getReactionSetKey(socket, data);
		const uids = await db.getSetMembers(set);
		const users = await user.getUsersFields(
			uids.slice(0, MAX_USERS_IN_FULL_LIST),
			['uid', 'username', 'userslug', 'picture', 'icon:text', 'icon:bgColor'],
		);
		return {
			total: uids.length,
			users: users.filter(u => u && parseInt(u.uid, 10) > 0),
		};
	},
};

