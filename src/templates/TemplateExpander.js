// @flow
import m from "mithril"
import type {SelectorItem} from "../gui/base/DropDownSelectorN"
import {DropDownSelectorN} from "../gui/base/DropDownSelectorN"
import stream from "mithril/stream/stream.js"
import type {LanguageCode} from "../misc/LanguageViewModel"
import {lang, languageByCode, languages} from "../misc/LanguageViewModel"
import {TEMPLATE_POPUP_HEIGHT} from "./TemplatePopup"
import {px} from "../gui/size"
import {Keys} from "../api/common/TutanotaConstants"
import {ButtonColors, ButtonN, ButtonType} from "../gui/base/ButtonN"
import {TemplateModel} from "./TemplateModel"
import {isKeyPressed} from "../misc/KeyManager"
import type {EmailTemplate} from "../api/entities/tutanota/EmailTemplate"
import {getLanguageCode} from "../settings/TemplateEditorModel"
import type {EmailTemplateContent} from "../api/entities/tutanota/EmailTemplateContent"
import {showTemplateEditor} from "../settings/TemplateEditor"
import {locator} from "../api/main/MainLocator"
import {Dialog} from "../gui/base/Dialog"
import {TemplateGroupRootTypeRef} from "../api/entities/tutanota/TemplateGroupRoot"
import {neverNull, noOp} from "../api/common/utils/Utils"
import {showKnowledgeBaseEditor} from "../settings/KnowledgeBaseEditor"
import {Icons} from "../gui/base/icons/Icons"
import {attachDropdown} from "../gui/base/DropdownN"

/**
 * TemplateExpander is the right side that is rendered within the Popup. Consists of Dropdown, Content and Button.
 * The Popup handles whether the Expander should be rendered or not, depending on available width-space.
 */

export type TemplateExpanderAttrs = {
	template: EmailTemplate,
	onDropdownCreate: (vnode: Vnode<*>) => void,
	onReturnFocus: () => void,
	onSubmitted: (string) => void,
	model: TemplateModel
}

export class TemplateExpander implements MComponent<TemplateExpanderAttrs> {
	_dropDownDom: HTMLElement

	view({attrs}: Vnode<TemplateExpanderAttrs>): Children {
		const {model} = attrs
		const selectedLanguage = model.getSelectedLanguage()
		return m(".flex.flex-column.flex-grow", {
			style: {
				maxHeight: px(TEMPLATE_POPUP_HEIGHT) // maxHeight has to be set, because otherwise the content would overflow outside the flexbox
			},
			onkeydown: (e) => {
				if (isKeyPressed(e.keyCode, Keys.TAB)) {
					e.preventDefault()
					if (document.activeElement === this._dropDownDom) {
						attrs.onReturnFocus()
					}
				}
			}
		}, [
			this._renderHeader(attrs, selectedLanguage),
			m(".scroll.pt.flex-grow.overflow-wrap",
				m.trust(model.getContentFromLanguage(selectedLanguage))
			)
		])
	}

	_renderHeader(attrs: TemplateExpanderAttrs, selectedLanguage: LanguageCode): Children {
		const {model, template} = attrs
		return m(".flex", {}, [
			// m(".flex-grow.mt-negative-s", m(DropDownSelectorN, {
			// 	label: "chooseLanguage_action",
			// 	items: this._returnLanguages(template.contents),
			// 	selectedValue: stream(selectedLanguage),
			// 	dropdownWidth: 250,
			// 	onButtonCreate: (buttonVnode) => {
			// 		this._dropDownDom = buttonVnode.dom
			// 		attrs.onDropdownCreate(buttonVnode)
			// 	},
			// 	selectionChangedHandler: (value) => {
			// 		model.setSelectedLanguage(value)
			// 		attrs.onReturnFocus()
			// 	},
			// })),
			m(".flex.center-vertically", [
				m(ButtonN, attachDropdown({
						label: () => selectedLanguage + ' ▼', // TODO
						title: "chooseLanguage_action",
						type: ButtonType.Toggle,
						click: noOp,
						noBubble: true,
						colors: ButtonColors.DrawerNav
					}, () => this._returnLanguages(template.contents).map(language => {
						return {
							label: () => language.value,
							type: ButtonType.Dropdown,
							click: () => console.log("Click"),
						}
					}
					)
				)),
				m(ButtonN, {
					label: "submit_label",
					click: (e) => {
						attrs.onSubmitted(model.getContentFromLanguage(selectedLanguage))
						e.stopPropagation()
					},
					type: ButtonType.ActionLarge,
					icon: () => Icons.Add,
					colors: ButtonColors.DrawerNav,
				}),
				m(ButtonN, {
					label: "edit_action",
					click: () => {
						locator.entityClient.load(TemplateGroupRootTypeRef, neverNull(template._ownerGroup)).then(groupRoot => {
							showTemplateEditor(template, groupRoot)
						})
					},
					type: ButtonType.ActionLarge,
					icon: () => Icons.Edit,
					colors: ButtonColors.DrawerNav,
				}),
				m(ButtonN, {
					label: "remove_action",
					click: () => {
						Dialog.confirm("deleteTemplate_msg").then((confirmed) => {
							if (confirmed) {
								const promise = locator.entityClient.erase(template)
								promise.then(() => console.log("removed"))
							}
						})
					},
					type: ButtonType.ActionLarge,
					icon: () => Icons.Trash,
					colors: ButtonColors.DrawerNav,
				})
			])
		])
	}

	_returnLanguages(contents: EmailTemplateContent[]): Array<SelectorItem<LanguageCode>> {
		return contents.map(content => {
			const languageCode = getLanguageCode(content)
			return {
				name: lang.get(languageByCode[languageCode].textId),
				value: languageCode
			}
		})
	}
}