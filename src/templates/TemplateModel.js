//@flow
import {lang} from "../misc/LanguageViewModel"
import {searchInTemplates} from "./TemplateSearchFilter"
import type {EmailTemplate} from "../api/entities/tutanota/EmailTemplate"
import {EmailTemplateTypeRef} from "../api/entities/tutanota/EmailTemplate"
import type {EntityEventsListener, EntityUpdateData} from "../api/main/EventController"
import {EventController, isUpdateForTypeRef} from "../api/main/EventController"
import {findAndRemove} from "../api/common/utils/ArrayUtils"
import {OperationType} from "../api/common/TutanotaConstants"
import stream from "mithril/stream/stream.js"
import type {EntityClient} from "../api/common/EntityClient"
import type {LoginController} from "../api/main/LoginController"
import {TemplateGroupModel} from "./TemplateGroupModel"
import {getElementId, isSameId} from "../api/common/utils/EntityUtils"
import type {EmailTemplateContent} from "../api/entities/tutanota/EmailTemplateContent"
import {neverNull} from "../api/common/utils/Utils"
import type {TemplateGroupInstances} from "./TemplateGroupModel"

/**
 *   Model that holds main logic for the Template Feature.
 *   Handles things like returning the selected Template, selecting Templates, indexes, scrolling.
 */

export type NavAction = "previous" | "next";

export const SELECT_NEXT_TEMPLATE = "next";
export const SELECT_PREV_TEMPLATE = "previous";

export class TemplateModel {
	_allTemplates: Array<EmailTemplate>
	_searchResults: Stream<Array<EmailTemplate>>
	_selectedTemplate: ?EmailTemplate
	_templateListId: Id
	_hasLoaded: boolean
	+_eventController: EventController;
	+_entityEventReceived: EntityEventsListener;
	+_logins: LoginController;
	+_entityClient: EntityClient;
	_templateGroupModel: TemplateGroupModel;

	_selectedContent: ?EmailTemplateContent


	constructor(eventController: EventController, logins: LoginController, entityClient: EntityClient, templateGroupModel: TemplateGroupModel) {
		this._eventController = eventController
		this._logins = logins
		this._entityClient = entityClient
		this._allTemplates = []
		this._searchResults = stream([])
		this._selectedTemplate = null
		this._hasLoaded = false
		this._templateGroupModel = templateGroupModel

		this._entityEventReceived = (updates) => {
			return this._entityUpdate(updates)
		}
		this._eventController.addEntityListener(this._entityEventReceived)
	}

	init(): Promise<void> { //TODO: Discuss
		const allEmailTemplates = []
		return this._templateGroupModel.init().then(templateGroupInstances => {
			return Promise.each(templateGroupInstances, templateGroupInstance => {
				return this._entityClient.loadAll(EmailTemplateTypeRef, templateGroupInstance.groupRoot.templates)
				           .then((templates) => {
					           allEmailTemplates.push(...templates)
				           })
			}).then(() => {
				this._allTemplates = allEmailTemplates
				this._searchResults(this._allTemplates)
				this.setSelectedTemplate(this.containsResult() ? this._searchResults()[0] : null)
				// set selected content to content which includes client language or to first content of selected template
				this._selectedContent = this._getContentWithClientLanguage()
					? this._getContentWithClientLanguage()
					: this._selectedTemplate ? this._selectedTemplate.contents[0] : null
				this._hasLoaded = true
			})
		})
	}

	containsResult(): boolean {
		return this._searchResults().length > 0
	}

	isSelectedTemplate(template: EmailTemplate): boolean {
		return (this._selectedTemplate === template)
	}

	getAllTemplates(): Array<EmailTemplate> {
		return this._allTemplates
	}

	getSearchResults(): Stream<Array<EmailTemplate>> {
		return this._searchResults
	}

	getSelectedTemplate(): ?EmailTemplate {
		return this._selectedTemplate
	}

	getSelectedTemplateGroupRoot(): ?TemplateGroupInstances {
		const selected = this._selectedTemplate
		if (selected) {
			return this._templateGroupModel.getGroupInstances().find(groupInstance => isSameId(groupInstance.groupRoot._id, neverNull(selected._ownerGroup)))
		}
		return null
	}

	getSelectedContent(): ?EmailTemplateContent {
		return this._selectedContent
	}

	hasLoaded(): boolean {
		return this._hasLoaded
	}

	getSelectedTemplateIndex(): number {
		return this._searchResults().indexOf(this._selectedTemplate)
	}

	setSelectedTemplate(template: ?EmailTemplate) { // call function to globally set a Template
		this._selectedTemplate = template
		if (template) {
			this._selectedContent = this._getContentWithClientLanguage()
				? this._getContentWithClientLanguage()
				: template.contents[0]
		}
	}

	setSelectedContent(content: EmailTemplateContent) {
		const selectedTemplate = this._selectedTemplate
		if (selectedTemplate) {
			this._selectedContent = selectedTemplate.contents.find(c => c === content)
		}
	}

	search(input: string): void {
		if (input === "") {
			this._searchResults(this._allTemplates)
		} else {
			this._searchResults(searchInTemplates(input, this._allTemplates))
		}
		this.setSelectedTemplate(this.containsResult() ? this._searchResults()[0] : null)
	}

	selectNextTemplate(action: NavAction): boolean { // returns true if selection is changed
		const selectedIndex = this.getSelectedTemplateIndex()
		const nextIndex = selectedIndex + (action === SELECT_NEXT_TEMPLATE ? 1 : -1)
		if (nextIndex >= 0 && nextIndex < this._searchResults().length) {
			const nextSelectedTemplate = this._searchResults()[nextIndex]
			this.setSelectedTemplate(nextSelectedTemplate)
			return true
		}
		return false
	}

	// returns the EmailTemplateContent with the Client Language when the language is included in the selected template
	_getContentWithClientLanguage(): ?EmailTemplateContent {
		const clientLanguageCode = lang.code
		const selectedTemplate = this._selectedTemplate
		return selectedTemplate ? selectedTemplate.contents.find(content => content.languageCode === clientLanguageCode) : null
	}

	dispose() {
		this._eventController.removeEntityListener(this._entityEventReceived)
	}

	findTemplateWithTag(selectedText: string): ?EmailTemplate {
		const tag = selectedText.substring(1) // remove # from selected text
		return this._allTemplates.find(template => template.tag === tag)
	}

	_entityUpdate(updates: $ReadOnlyArray<EntityUpdateData>): Promise<void> {
		return Promise.each(updates, update => {
			if (isUpdateForTypeRef(EmailTemplateTypeRef, update)) {
				if (update.operation === OperationType.CREATE) {
					return this._entityClient.load(EmailTemplateTypeRef, [update.instanceListId, update.instanceId])
					           .then((template) => {
						           this._allTemplates.push(template)
						           this._searchResults(this._allTemplates)
					           })

				} else if (update.operation === OperationType.UPDATE) {
					return this._entityClient.load(EmailTemplateTypeRef, [update.instanceListId, update.instanceId])
					           .then((template) => {
						           findAndRemove(this._allTemplates, (t) => isSameId(getElementId(t), update.instanceId))
						           this._allTemplates.push(template)
						           this._searchResults(this._allTemplates)
					           })
				} else if (update.operation === OperationType.DELETE) {
					findAndRemove(this._allTemplates, (t) => isSameId(getElementId(t), update.instanceId))
					this._searchResults(this._allTemplates)
				}
			}
		}).return()
	}
}


