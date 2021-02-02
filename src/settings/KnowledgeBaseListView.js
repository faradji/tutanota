// @flow

import m from "mithril"
import {SettingsView} from "./SettingsView"
import {KnowledgeBaseDetailsViewer} from "./KnowledgeBaseDetailsViewer"
import type {KnowledgeBaseEntry} from "../api/entities/tutanota/KnowledgeBaseEntry"
import {KnowledgeBaseEntryTypeRef} from "../api/entities/tutanota/KnowledgeBaseEntry"
import {ButtonN, ButtonType} from "../gui/base/ButtonN"
import {lang} from "../misc/LanguageViewModel"
import {List} from "../gui/base/List"
import type {EntityUpdateData} from "../api/main/EventController"
import {isUpdateForTypeRef} from "../api/main/EventController"
import {size} from "../gui/size"
import {assertMainOrNode} from "../api/Env"
import type {TemplateGroupRoot} from "../api/entities/tutanota/TemplateGroupRoot"
import {EntityClient} from "../api/common/EntityClient"
import {showKnowledgeBaseEditor} from "./KnowledgeBaseEditor"
import {isSameId} from "../api/common/utils/EntityUtils"

assertMainOrNode()

/**
 *  List that is rendered within the knowledgebase Settings
 */

export class KnowledgeBaseListView implements UpdatableSettingsViewer {
	_list: List<KnowledgeBaseEntry, KnowledgeBaseRow>
	_listId: ?Id
	_settingsView: SettingsView
	_templateGroupRoot: TemplateGroupRoot
	_entityClient: EntityClient

	constructor(settingsView: SettingsView, entityClient: EntityClient, templateGroupRoot: TemplateGroupRoot) {
		this._settingsView = settingsView
		this._entityClient = entityClient
		this._templateGroupRoot = templateGroupRoot
		this._initKnowledgeBaseList()
	}

	_initKnowledgeBaseList() {
		const knowledgebaseListId = this._templateGroupRoot.knowledgeBase
		const listConfig: ListConfig<KnowledgeBaseEntry, KnowledgeBaseRow> = {
			rowHeight: size.list_row_height,
			fetch: (startId, count) => {
				return this._entityClient.loadRange(KnowledgeBaseEntryTypeRef, knowledgebaseListId, startId, count, true)
			},
			loadSingle: (elementId) => {
				return this._entityClient.load(KnowledgeBaseEntryTypeRef, [knowledgebaseListId, elementId])
			},
			sortCompare: (a: KnowledgeBaseEntry, b: KnowledgeBaseEntry) => {
				var titleA = a.title.toUpperCase();
				var titleB = b.title.toUpperCase();
				return (titleA < titleB) ? -1 : (titleA > titleB) ? 1 : 0
			},
			elementSelected: (entries: Array<KnowledgeBaseEntry>, elementClicked) => {
				if (elementClicked) {
					this._settingsView.detailsViewer = new KnowledgeBaseDetailsViewer(entries[0], this._entityClient)
					this._settingsView.focusSettingsDetailsColumn()
				} else if (entries.length === 0 && this._settingsView.detailsViewer) {
					this._settingsView.detailsViewer = null
					m.redraw()
				}

			},
			createVirtualRow: () => {
				return new KnowledgeBaseRow()
			},
			showStatus: false,
			className: "knowledgeBase-list",
			swipe: {
				renderLeftSpacer: () => [],
				renderRightSpacer: () => [],
				swipeLeft: (listElement) => Promise.resolve(),
				swipeRight: (listElement) => Promise.resolve(),
				enabled: false
			},
			elementsDraggable: false,
			multiSelectionAllowed: false,
			emptyMessage: lang.get("noEntries_msg"),
		}
		this._listId = knowledgebaseListId
		this._list = new List(listConfig)
		this._list.loadInitial()
		m.redraw()
	}

	view(): Children {
		return m(".flex.flex-column.fill-absolute", [
			m(".flex.flex-column.justify-center.plr-l.list-border-right.list-bg.list-header",
				m(".mr-negative-s.align-self-end", m(ButtonN, {
					label: "addEntry_label",
					type: ButtonType.Primary,
					click: () => {
						showKnowledgeBaseEditor(null, this._templateGroupRoot)
					}
				}))
			),
			m(".rel.flex-grow", this._list ? m(this._list) : null)
		])
	}

	entityEventsReceived(updates: $ReadOnlyArray<EntityUpdateData>): Promise<void> {
		return Promise.each(updates, update => {
			const list = this._list
			if (list && this._listId && isUpdateForTypeRef(KnowledgeBaseEntryTypeRef, update)
				&& isSameId(this._listId, update.instanceListId)) {
				return this._list.entityEventReceived(update.instanceId, update.operation)
			}
		}).then(() => {
			this._settingsView.detailsViewer = null
			m.redraw()
		})
	}
}

export class KnowledgeBaseRow {
	top: number;
	domElement: ?HTMLElement;
	entity: ?KnowledgeBaseEntry;
	_domEntryTitle: HTMLElement;

	constructor() {
		this.top = 0
	}

	update(entry: KnowledgeBaseEntry, selected: boolean): void {
		if (!this.domElement) {
			return
		}
		if (selected) {
			this.domElement.classList.add("row-selected")
		} else {
			this.domElement.classList.remove("row-selected")
		}
		this._domEntryTitle.textContent = entry.title
	}

	render(): Children {
		return [
			m(".top", [
				m(".name.text-ellipsis", {oncreate: (vnode) => this._domEntryTitle = vnode.dom}),
			]),
		]
	}
}