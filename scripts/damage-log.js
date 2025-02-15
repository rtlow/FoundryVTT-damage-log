/*
 * Damage Log
 * https://github.com/cs96and/FoundryVTT-damage-log
 *
 * Copyright (c) 2021-2024 Alan Davies - All Rights Reserved.
 *
 * You may use, distribute and modify this code under the terms of the MIT license.
 *
 * You should have received a copy of the MIT license with this file. If not, please visit:
 * https://mit-license.org/
 */

import { DamageLogMigration } from "./migration.js";
import { DamageLogSettings } from "./settings.js";

/**
 * Initialization.  Create the DamageLog.
 */
Hooks.once("setup", () => game.damageLog = new DamageLog());

Hooks.once("chat-tabs.init", () => {
	const data = {
		key: "damage-log",
		label: game.i18n.localize("damage-log.damage-log-tab-name"),
		hint: game.i18n.localize("damage-log.customizable-chat-tabs-hint")
	};
	game.chatTabs.register(data);
});

class DamageLog {

	/**
	 * Location of HP attributes in D&D-like systems.
	 */
	static DND_ATTRIBUTES = {
		hp: {
			value: "attributes.hp.value",
			min: "attributes.hp.min",
			max: "attributes.hp.max",
			tempMax: "attributes.hp.tempMax",
		},
		temp: {
			value: "attributes.hp.temp"
		}
	};

	/**
	 * Location of HP attributes for supported systems.
	 */
	static SYSTEM_CONFIGS = {
		ac2d20: {
			fatigue: {
				invert: true,
				value: "fatigue"
			},
			fortune: {
				invert: false,
				value: "fortune.value"
			},
			injuries: {
				invert: true,
				value: "injuries.value"
			},
			stress: {
				invert: true,
				value: "stress.value",
				max: "stress.max"
			}			
		},
		"age-of-sigmar-soulbound": {
			toughness: {
				value: "combat.health.toughness.value",
				max: "combat.health.toughness.max"
			}
		},
		archmage: DamageLog.DND_ATTRIBUTES,
		D35E: mergeObject(DamageLog.DND_ATTRIBUTES, {
			vigor: {
				value: "attributes.vigor.value",
				min: "attributes.vigor.min",
				max: "attributes.vigor.max"
			},
			vigorTemp: {
				value: "attributes.vigor.temp"
			},
			wounds: {
				value: "attributes.wounds.value",
				min: "attributes.wounds.min",
				max: "attributes.wounds.max"
			}
		}),
		demonlord: {
			corruption: {
				invert: true,
				value: "characteristics.corruption.value",
				min: "characteristics.corruption.min",
			},
			damage: {
				invert: true,
				value: "characteristics.health.value",
				max: "characteristics.health.max",
			},
			insanity: {
				invert: true,
				value: "characteristics.insanity.value",
				min: "characteristics.insanity.min",
				max: "characteristics.insanity.max",
			},
		},
		dnd5e: DamageLog.DND_ATTRIBUTES,
		gurps: {
			hp: {
				value: "HP.value",
				min: "HP.min",
				max: "HP.max"
			},
			fp: {
				value: "FP.value",
				min: "FP.min",
				max: "FP.max"
			}
		},
		pf1: DamageLog.DND_ATTRIBUTES,
		pf2e: mergeObject(DamageLog.DND_ATTRIBUTES, {
			sp: {
				value: "attributes.sp.value",
				max: "attributes.sp.max"
			}
		}),
		shaper: {
			hp: {
				value: "attributes.hp.value",
				min: "attributes.hp.min",
				max: "attributes.hp.max"
			},
			temp: {
				value: "attributes.hp.temp"
			}
		},
		sw5e: DamageLog.DND_ATTRIBUTES,
		swade: {
			wounds: {
				invert: true,
				value: "wounds.value",
				min: "wounds.min",
				max: "wounds.max"
			},
			fatigue: {
				invert: true,
				value: "fatigue.value",
				min: "fatigue.min",
				max: "fatigue.max"
			},
			bennies: {
				invert: false,
				value: "bennies.value",
				min: "bennies.min",
				max: "bennies.max"
			}
		},
		tormenta20: {
			pv: {
				value: "attributes.pv.value",
				min: "attributes.pv.min",
				max: "attributes.pv.max",
			},
			temp: {
				value: "attributes.pv.temp"
			}
		},
		worldbuilding: {
			hp: {
				value: "health.value",
				min: "health.min",
				max: "health.max"
			}
		}
	};

	static TABS_TEMPLATE = "modules/damage-log/templates/damage-log-tabs.hbs";
	static TABLE_TEMPLATE = "modules/damage-log/templates/damage-log-table.hbs";

	/**
	 * DamageLog constructor.
	 * @constructor
	 */
	constructor() {
		this.settings = new DamageLogSettings();
		this.systemConfig = DamageLog.SYSTEM_CONFIGS[game.system.id];
		this.tabs = null;
		this.currentTab = "chat";
		this.hasTabbedChatlog = !!game.modules.get("tabbed-chatlog")?.active;
		this.hasCustomizableChatTabs = !!game.modules.get("chat-tabs")?.active;
		this.hasPf2eDorakoUi = !!game.modules.get("pf2e-dorako-ui")?.active;
		this.damageType = "";
		this.prevScrollTop = 0;

		if (!this.systemConfig) {
			Hooks.once("ready", () => ui.notifications.error(game.i18n.format("damage-log.error.system-not-supported", { systemId: game.system.id })));
			throw false;
		}

		loadTemplates([DamageLog.TABS_TEMPLATE, DamageLog.TABLE_TEMPLATE]);

		if (this.settings.useTab)
		{
			Hooks.on("renderChatLog", this._onRenderChatLog.bind(this));
			Hooks.on('changeSidebarTab', this._onChangeSidebarTab.bind(this));
			Hooks.on("collapseSidebar", this._onCollapseSidebar.bind(this));
		}
		Hooks.on('getChatLogEntryContext', this._onGetChatLogEntryContext.bind(this));
		Hooks.on('preUpdateActor', this._onPreUpdateActor.bind(this));
		Hooks.on('updateActor', this._onUpdateActor.bind(this));
		Hooks.on('preUpdateChatMessage', this._onPreUpdateChatMessage.bind(this));
		Hooks.on('renderChatMessage', this._onRenderChatMessage.bind(this));

		if (game.modules.get('lib-wrapper')?.active) {
			libWrapper.register('damage-log', 'ChatLog.prototype.notify', this._onChatLogNotify, 'MIXED');

			if (!this.hasCustomizableChatTabs) {
				libWrapper.register('damage-log', 'Messages.prototype.flush', this._onMessageLogFlush.bind(this), 'MIXED');
				libWrapper.register('damage-log', 'ChatLog.prototype.updateTimestamps', this._onUpdateTimestamps, 'WRAPPER');
			}

			libWrapper.ignore_conflicts('damage-log', ['actually-private-rolls', 'hide-gm-rolls', 'monks-little-details'], 'ChatLog.prototype.notify');
		}

		// Ready handling.  Convert damage log messages flag to new format.
		Hooks.once("ready", async () => {
			if (!game.modules.get('lib-wrapper')?.active && game.user.isGM)
				ui.notifications.error("Damage Log requires the 'libWrapper' module. Please install and activate it.", { permanent: true });

			await DamageLogMigration.migrateFlags();
		});

		// If this is dnd5e 3.0.0 or greater, copy the styles for #chat-log to #damage-log
		if ((game.system.id == "dnd5e") && (!isNewerVersion("3.0.0", game.system.version))) {
			let damageLogStyleSheet = new CSSStyleSheet()
			for (const sheet of document.styleSheets) {
				if (sheet.href.endsWith("dnd5e.css")) {
					for (const rule of sheet.cssRules) {
						if ((rule instanceof CSSStyleRule) && rule.selectorText?.includes("#chat-log")) {
							const newRule = rule.cssText.replaceAll("#chat-log", "#damage-log");
							damageLogStyleSheet.insertRule(newRule, damageLogStyleSheet.cssRules.length);
						}
					}
					break;
				}
			}
			document.adoptedStyleSheets.push(damageLogStyleSheet);
		}
	}

	/**
	 * Handle the "renderChatLog" hook.
	 * This creates the separate tab for the damage log.
	 * It also sets up a mutation observer to move any damage messages to the damage log tab.
	 */
	async _onRenderChatLog(chatTab, html, user) {
		if (!game.user.isGM && !this.settings.allowPlayerView) return;

		// If Customizable Chat Tabs is enabled, then we'll let that module sort out setting up the tabs.
		if (this.hasCustomizableChatTabs)
			return

		if (this.hasTabbedChatlog) {
			// Force Tabbed Chatlog to render first
			await new Promise(r => {
				this._onTabbedChatlogRenderChatLog(chatTab, html, user);
				this.currentTab = game.tabbedchat.tabs.active;
				r();
			});
		} else {
			const tabsHtml = await renderTemplate(DamageLog.TABS_TEMPLATE);
			html[0].insertAdjacentHTML("afterBegin", tabsHtml);

			const tabs = new Tabs({
				navSelector: ".damage-log-nav.tabs",
				contentSelector: undefined,
				initial: this.currentTab,
				callback: (event, tabs, tab) => this._onTabSwitch(event, tabs, tab, chatTab)
			});
			tabs.bind(html[0]);

			if (!chatTab.popOut)
				this.tabs = tabs;
		}

		const chatLogElement = html[0].querySelector("#chat-log");
		chatLogElement.insertAdjacentHTML("afterEnd", '<ol id="damage-log"></ol>');

		// Move all the damage log messages into the damage log tab.
		const damageLogElement = html[0].querySelector("#damage-log");
		const damageMessages = chatLogElement.querySelectorAll(".message.damage-log");
		damageLogElement.append(...damageMessages);
		damageMessages.forEach(m => m.classList.contains("not-permitted") && m.remove());

		this._onTabSwitch(undefined, undefined, this.currentTab, chatTab);

		// Handle scrolling the damage log
		damageLogElement.addEventListener("scroll", this._onScroll.bind(this));

		// Listen for items being added to the chat log.  If they are damage messages, move them to the damage log tab.
		const observer = new MutationObserver((mutationList, observer) => {
			for (const mutation of mutationList) {
				if (0 === mutation.addedNodes.length) continue;

				// Check if the messages are being added to the top or bottom of the chat log
				const firstChatLogMessageId = chatLogElement.querySelector("li")?.getAttribute("data-message-id");
				const firstAppendedMessageId = mutation.addedNodes[0]?.getAttribute("data-message-id");
				const shouldPrepend = (firstAppendedMessageId === firstChatLogMessageId);
				
				const nodes = [...mutation.addedNodes].filter(n => {
					if (n.classList.contains("not-permitted"))
						n.remove();
					else if (n.classList.contains("damage-log"))
						return true;
					return false;
				});

				if (0 !== nodes.length) {
					if (shouldPrepend) {
						damageLogElement.prepend(...nodes);
					}
					else {
						damageLogElement.append(...nodes);
						damageLogElement.scrollTo({ top: damageLogElement.scrollHeight, behavior: "smooth" });
					}
				}
			}
		});

		observer.observe(chatLogElement, { childList: true });
	}

	/**
	 * Creates the damage log tab when Tabbed Chatlog module is installed.
	 */
	_onTabbedChatlogRenderChatLog(chatTab, html, user) {
		// Append our tab to the end of Tabbed Chatlog's tabs
		const tabs = html[0].querySelector(".tabbedchatlog.tabs");
		tabs.insertAdjacentHTML("beforeEnd", `<a class="item damage-log" data-tab="damage-log">${game.i18n.localize("damage-log.damage-log-tab-name")}</a>`);

		// Override Tabbed Chatlog's callback to call our _onTabSwitch() function first.
		const tabbedChatlogCallback = game.tabbedchat.tabs.callback;
		game.tabbedchat.tabs.callback = ((event, html, tab) => {
			this._onTabSwitch(event, html, tab, chatTab);
			tabbedChatlogCallback(event, html, tab);
		});

		if (chatTab.popOut) {
			if ("damage-log" === this.currentTab) {
				html[0].querySelectorAll(".item.active").forEach(elem => elem.classList.remove("active"));
				html[0].querySelectorAll(".item.damage-log").forEach(elem => elem.classList.add("active"));
			}
		}
	}

	/**
	 * Handle the user switching tabs.
	 */
	_onTabSwitch(event, tabs, tab, chatTab) {
		if (!chatTab.popOut)
			this.currentTab = tab;

		const chatLog = chatTab.element[0].querySelector("#chat-log");
		const damageLog = chatTab.element[0].querySelector("#damage-log");

		if (tab === "damage-log") {
			chatLog.style.display = "none";
			damageLog.style.display = "";
			damageLog.scrollTop = damageLog.scrollHeight;
			this.prevScrollTop = damageLog.scrollTop;
		}
		else
		{
			damageLog.style.display = "none";
			chatLog.style.display = "";
			chatLog.scrollTop = chatLog.scrollHeight;
		}
	}

	/**
	 *	Disable the chat notification on damage log messages.
	 */
	_onChatLogNotify(wrapper, message, ...args) {
		if (message?.flags["damage-log"])
			return;

		return wrapper(message, ...args);
	}

	/**
	 *	Handle updating the timestamps on damage log messages.
	 */
	_onUpdateTimestamps(wrapper, ...args) {
		wrapper(...args);

		// "this" will be a ChatLog here
		const messages = this.element.find(".damage-log.message");
		for (const li of messages) {
			const message = game.messages.get(li.dataset["messageId"]);
			if (!message || !message.timestamp) continue;

			const stamp = li.querySelector('.message-timestamp');
			stamp.textContent = foundry.utils.timeSince(message.timestamp);
		}
	}

	_onMessageLogFlush(wrapper, ...args) {
		if (this.hasTabbedChatlog && (this.currentTab === "damage-log")) {
			return Dialog.confirm({
				title: game.i18n.localize("CHAT.FlushTitle"),
				content: game.i18n.localize("CHAT.FlushWarning"),
				yes: () => {
					const damageLogMessagesIds = game.messages.filter(message => "damage-log" in message.flags).map(message => message.id);
					game.messages.documentClass.deleteDocuments(damageLogMessagesIds, {deleteAll: false});
				},
				options: {
					top: window.innerHeight - 150,
					left: window.innerWidth - 720
				}
			});
		}
		else {
			return wrapper(...args);
		}
	}

	/**
	 * Handle scrolling to top of the damage log.  If the scrollbar reaches the top, load more messages.
	 */
	async _onScroll(event) {
		const element = event.target;

		// Only try to load more messages if we are scrolling upwards
		if ((0 === element.scrollTop) && (element.scrollTop < this.prevScrollTop)) {
			const scrollBottom = element.scrollHeight;
			await ui.chat._renderBatch(ui.chat.element, CONFIG.ChatMessage.batchSize);
			element.scrollTop = element.scrollHeight - scrollBottom;
		}

		this.prevScrollTop = element.scrollTop;
	}

	/**
	 * Handle the "changeSidebarTab" hook.
	 * When switching to Foundry's "chat" tab, make sure the damage-log's current tab is marked as active.
	 */
	_onChangeSidebarTab(tab) {
		if (tab.id === "chat")
			this.tabs?.activate(this.currentTab);
	}

	/**
	 * Handle the sidebar collapsing / being revealed.
	 * When the sidebar is revealed and the current tab is the damage log, scroll to the end of the log
	 * For some reason this doesn't work unless we wait at least 250ms first.
	 */
	_onCollapseSidebar(sidebar, isCollapsing) {
		if (!isCollapsing && ("damage-log" === this.currentTab)) {
			const damageLog = sidebar.element[0].querySelector("#damage-log");
			setTimeout(() => damageLog.scrollTop = damageLog.scrollHeight, 250);
		}
	}

	/**
	 * Handle the "getChatLogEntryContext" hook.
	 * This sets up the right-click context menus for chat messages.
	 */
	_onGetChatLogEntryContext(html, options) {
		const getMessage = li => game.messages.get(li[0].dataset["messageId"]);

		const resetVisibility = {
			name: game.i18n.localize("damage-log.reset-visibility"),
			icon: '<i class="fad fa-glasses"></i>',
			condition: (li) => {
				if (!game.user.isGM) return false;
	
				const message = getMessage(li);
				return (typeof(message?.getFlag("damage-log", "public")) == "boolean");
			},
			callback: li => this._resetVisibility(li[0])
		};

		// Put the Reset Visibility menu item after the Reveal/Conceal options
		let index = options.findIndex(o => o.name === "CHAT.ConcealMessage");
		if (index >= 0) ++index;
		options.splice(index, 0, resetVisibility);

		const canUndo = (li) => {
			if (game.user.isGM) return true;
			if (!this.settings.allowPlayerUndo) return false;

			const message = getMessage(li);
			const actor = ChatMessage.getSpeakerActor(message?.speaker);
			return actor?.testUserPermission(game.user, CONST.DOCUMENT_PERMISSION_LEVELS.OWNER);
		};

		options.push(
			{
				name: game.i18n.localize("damage-log.undo-damage"),
				icon: '<i class="fas fa-undo-alt"></i>',
				condition: li => canUndo(li) && li[0].matches(".damage-log.damage:not(.reverted)"),
				callback: li => this._undoDamage(li[0])
			},
			{
				name: game.i18n.localize("damage-log.undo-healing"),
				icon: '<i class="fas fa-undo-alt"></i>',
				condition: li => canUndo(li) && li[0].matches(".damage-log.healing:not(.reverted)"),
				callback: li => this._undoDamage(li[0])
			},
			{
				name: game.i18n.localize("damage-log.redo-damage"),
				icon: '<i class="fas fa-redo-alt"></i>',
				condition: li => canUndo(li) && li[0].matches(".damage-log.damage.reverted"),
				callback: li => this._undoDamage(li[0])
			},
			{
				name: game.i18n.localize("damage-log.redo-healing"),
				icon: '<i class="fas fa-redo-alt"></i>',
				condition: li => canUndo(li) && li[0].matches(".damage-log.healing.reverted"),
				callback: li => this._undoDamage(li[0])
			}
		);
	}

	/**
	 * Handle the "preUpdateActor" hook.
	 * Calculate the difference between the old and new HP values for the actor and creates the damage log chat message.
	 */
	async _onPreUpdateActor(actor, updateData, options, userId) {
		if (userId !== game.user.id) return;
		if (options["damage-log"]?.messageId) return;

		const speaker = ChatMessage.getSpeaker({ actor, token: actor.token });

		// Get a nested property of an object using a string.
		const getAttrib = (obj, path) => {
			return path && path.split('.').reduce((prev, curr) => prev && prev[curr], obj);
		}

		const flags = {};

		for (const [ id, config ] of Object.entries(this.systemConfig)) {
			let localizationId = `damage-log.${game.system.id}.${id}-name`;
			if (!game.i18n.has(localizationId))
				localizationId = `damage-log.default.${id}-name`;
			const name = (game.i18n.has(localizationId) ? game.i18n.localize(localizationId) : id);

			const oldValue = getAttrib(actor.system, config.value) ?? 0;
			const newValue = getAttrib(updateData.system, config.value) ?? oldValue;
			const diff = newValue - oldValue;
	
			if (0 != diff) {
				flags.changes ??= [];
				flags.changes.push({ id, name, old: oldValue, new: newValue, diff });
			}
		}

		if (isEmpty(flags)) return;

		if (this.settings.useTab && this.hasTabbedChatlog)
		{
			// If the rolls notification is not currently showing, set a flag so we can prevent it from showing in _onRenderChatMessage.
			const rollsNotification = document.getElementById("rollsNotification");
			if (rollsNotification?.style.display === "none")
				flags.preventRollsNotification = true;
		}

		const { isHealing, totalDiff } = this._analyseFlags(flags);

		const flavorOptions = {
			diff: Math.abs(totalDiff),
			damageType: this.damageType
		};

		const content = flags.changes.reduce((prev, curr) => {
			return prev + `${curr.id}: ${curr.old} -&gt; ${curr.new} `
		}, '');

		const chatData = {
			flags: { "damage-log": flags },
			type: CONST.CHAT_MESSAGE_TYPES.OTHER,
			flavor: game.i18n.format((isHealing ? "damage-log.healing-flavor-text" : "damage-log.damage-flavor-text"), flavorOptions),
			content,
			speaker,
			whisper: this._calculteWhisperData(actor, isHealing)
		};

		if (this.hasCustomizableChatTabs) {
			chatData.flags["chat-tabs"] = {
				module: "damage-log"
			}
		}

		ChatMessage.create(chatData, {});
	}

	/**
	 * Handle the "updateActor" hook.
	 * Only interested in this hook when the user reverts or re-applys damage/healing.
	 * Sets or clears the "reverted" flag in the message.
	 */
	_onUpdateActor(actor, updateData, options, userId) {
		const flags = options["damage-log"];
		if (flags?.messageId)
		{
			const message = game.messages.get(flags.messageId);
			if (!message) return;

			// If the user that created the message is connected, let their client update the message.
			// Otherwise let the GM do it.
			if (message.user.active ? (message.user.id === game.user.id) : game.user.isGM)
			{
				// Changing the message flags will cause the renderChatMessage hook to fire
				if (flags.revert)
					message.setFlag("damage-log", "revert", true);
				else
					message.unsetFlag("damage-log", "revert");
			}
		}
	}

	/**
	 * 	Handle a Damage Log chat message being made public or private.
	 */
	_onPreUpdateChatMessage(message, changes, options, userId) {
		if (("whisper" in changes) && message?.flags["damage-log"]) {
			// Damage Log message is being made private or public

			// Don't alter the public flag if it is being removed.
			if (changes.flags?.["damage-log"]?.["-=public"] !== null) {
				const isPublic = ((null == changes.whisper) || (0 === changes.whisper.length));
				changes["flags.damage-log.public"] = isPublic;
			}
		}
	}

	/**
	 * Handle the "renderChatMessage" hook.
	 * Applies classes to the message's HTML based on the message flags.
	 */
	async _onRenderChatMessage(message, html, data) {
		const flags = message?.flags["damage-log"];
		if (!flags) return;

		const classList = html[0].classList;

		classList.add("damage-log");

		if (flags.revert)
			classList.add("reverted");
		else
			classList.remove("reverted");

		const isHealing = this._analyseFlags(flags).isHealing;
		if (isHealing)
			classList.add("healing");
		else
			classList.add("damage");

		// Work out if the user is allowed to see the damage table, and then add it to the HTML.
		let canViewTable = game.user.isGM || !!flags.public
		if (!canViewTable && this.settings.allowPlayerView) {
			const actor = ChatMessage.getSpeakerActor(message?.speaker);
			canViewTable = this._canUserViewActorDamage(game.user, actor);
		}

		if (!canViewTable && (!this.settings.showLimitedInfoToPlayers || (isHealing && this.settings.hideHealingInLimitedInfo)))
			classList.add("not-permitted");

		if (this.settings.useTab && this.hasTabbedChatlog) {
			// Do the following after Tabbed Chatlog has rendered.
			new Promise(r => {
				// If the rolls notification wasn't showing before the message was created, then hide it again.
				// TODO - this currently only works for the user that modified the token.
				if (flags.preventRollsNotification) {
					const rollsNotification = document.getElementById("rollsNotification");
					if (rollsNotification)
						rollsNotification.style.display = "none";
				}
				classList.remove("hardHide");
				classList.add("hard-show")
				html[0].style.display = "";
				r();
			});
		}

		const content = html[0].querySelector("div.message-content");

		// Dorako UI moves the flavor text into the message content.  Extract it so we don't overwrite it with the table.
		const flavorText = (this.hasPf2eDorakoUi) ? content.querySelector("span.flavor-text")?.outerHTML ?? "" : "";

		// The current content is just some placeholder text.  Completely replace it with the HTML table, or nothing if the user is not allowed to see it.
		content.innerHTML = flavorText + (canViewTable ? await renderTemplate(DamageLog.TABLE_TEMPLATE, flags) : "");
	}

	/**
	 * Calculate the array of users who can see a given actor's damage info.
	 */
	_calculteWhisperData(actor, isHealing) {
		// If limited player view is enabled, send messages to all players (confidential info will get stripped out in _onRenderChatMessage)
		// Otherwise, only send the message to the players who have the correct permissions.
		if (!this.settings.allowPlayerView || (!this.settings.showLimitedInfoToPlayers || (isHealing && this.settings.hideHealingInLimitedInfo)))
			return game.users.contents.filter(user => this._canUserViewActorDamage(user, actor)).map(user => user.id);

		return [];
	}

	/**
	 * Check whether a user has permission to see a given actor's damage info or not.
	 */
	_canUserViewActorDamage(user, actor) {
		if (user.isGM) return true;
		if (!this.settings.allowPlayerView) return false;
 
		return actor?.testUserPermission(user, this.settings.minPlayerPermission);
	};

	_resetVisibility(li) {
		const message = game.messages.get(li.dataset["messageId"]);
		const flags = message.flags?.["damage-log"];

		const actor = game.actors.get(message.speaker.actor);
		const isHealing = flags && this._analyseFlags(flags).isHealing;

		message.update({
			whisper: this._calculteWhisperData(actor, isHealing),
			"flags.damage-log": { "-=public": null }
		});
	}

	/**
	 * Undo the the damage on a given message.
	 */
	_undoDamage(li) {
		const message = game.messages.get(li.dataset["messageId"]);
		const speaker = message.speaker;
		const flags = message.flags["damage-log"];

		if (!speaker.scene)
		{
			ui.notifications.error(game.i18n.localize("damage-log.error.scene-id-missing"));
			return;
		}

		const scene = game.scenes.get(speaker.scene);
		if (!scene)
		{
			ui.notifications.error(game.i18n.format("damage-log.error.scene-deleted", { scene: speaker.scene }));
			return;
		}

		if (!speaker.token)
		{
			ui.notifications.error(game.i18n.localize("damage-log.error.token-id-missing"));
			return;
		}

		const token = scene.tokens.get(speaker.token);
		if (!token)
		{
			ui.notifications.error(game.i18n.format("damage-log.error.token-deleted", { token: speaker.token }));
			return;
		}

		const modifier = li.classList.contains("reverted") ? -1 : 1;

		// Check the user that created the message is connected, or there is a GM is connected.
		if (!message.user.active) {
			const activGMs = game.users.filter(u => u.isGM && u.active);
			if (!activGMs || (0 === activGMs.length)) {
				const messageFlags = {
					undo: ((modifier > 0) ? "undo" : "redo"),
					damage: li.classList.contains("healing") ? "healing" : "damage",
					user: message.user.name
				};
				ui.notifications.error(game.i18n.format("damage-log.error.no-undo-user", messageFlags));
			}
		}

		// Get a nested property of actorData.data using a string.
		const getActorAttrib = (path) => {
			return path && path.split('.').reduce((prev, curr) => prev && prev[curr], token.actor.system);
		}

		const update = {};

		for (const change of flags.changes) {
			const config = this.systemConfig[change.id];
			if (!config) continue;

			let newValue = getActorAttrib(config.value) - (change.diff * modifier);

			if (this.settings.clampToMin) {
				const min = getActorAttrib(config.min) ?? 0;
				newValue = Math.max(newValue, min);
			}

			if (this.settings.clampToMax && config.max) {
				const max = getActorAttrib(config.max) + (getActorAttrib(config.tempMax) ?? 0);
				newValue = Math.min(newValue, max);
			}

			update[`system.${config.value}`] = newValue;
		}

		token.actor.update(update, { "damage-log": { revert: modifier > 0, messageId: message.id } });
	}

	/**
	 * Returns an object containing data about the healing/damage in the flags.
	 */
	_analyseFlags(flags) {
		// Sum up all the diffs in the changes section of the flags.
		// If the "invert" paramater is true, subtract the diff rather than adding.
		const totalDiff = flags.changes.reduce((prev, curr) => { 
			if (this.systemConfig[curr.id]?.invert === true)
				return prev - curr.diff;
			else
				return prev + curr.diff;
		}, 0);

		return { isHealing: totalDiff > 0, totalDiff } ;
	}
}

