// @flow
import m from "mithril"
import {lang} from "../../misc/LanguageViewModel"
import {List} from "../../gui/base/List"
import {HttpMethod} from "../../api/common/EntityFunctions"
import {serviceRequestVoid} from "../../api/main/Entity"
import {CounterType_UnreadMails, MailFolderType} from "../../api/common/TutanotaConstants"
import type {MailView} from "./MailView"
import type {Mail} from "../../api/entities/tutanota/Mail"
import {MailTypeRef} from "../../api/entities/tutanota/Mail"
import {assertMainOrNode} from "../../api/common/Env"
import {getArchiveFolder, getFolderName, getInboxFolder} from "../model/MailUtils"
import {findAndApplyMatchingRule, isInboxList} from "../model/InboxRuleHandler"
import {NotFoundError} from "../../api/common/error/RestError"
import {size} from "../../gui/size"
import {Icon} from "../../gui/base/Icon"
import {Icons} from "../../gui/base/icons/Icons"
import {logins} from "../../api/main/LoginController"
import type {ButtonAttrs} from "../../gui/base/ButtonN"
import {ButtonColors, ButtonN, ButtonType} from "../../gui/base/ButtonN"
import {Dialog} from "../../gui/base/Dialog"
import {MonitorService} from "../../api/entities/monitor/Services"
import {createWriteCounterData} from "../../api/entities/monitor/WriteCounterData"
import {assertNotNull, debounce, neverNull} from "../../api/common/utils/Utils"
import {worker} from "../../api/main/WorkerClient"
import {locator} from "../../api/main/MainLocator"
import {getLetId, haveSameId, isSameId, sortCompareByReverseId} from "../../api/common/utils/EntityUtils";
import {bundleMail, bundleMails, moveMails, promptAndDeleteMails} from "./MailGuiUtils"
import {MailRow} from "./MailRow"
import {uniqueInsert} from "../../api/common/utils/ArrayUtils"
import {fileApp} from "../../native/common/FileApp"
import {makeTrackedProgressMonitor, ProgressMonitor} from "../../api/common/utils/ProgressMonitor"

assertMainOrNode()

const className = "mail-list"


export class MailListView implements Component {
	listId: Id;
	mailView: MailView;
	list: List<Mail, MailRow>;

	// Mails that are currently being downloaded for export
	// We don't currently actually care about the contents of the promise, we only want to wait on them
	mailsBeingBundled: Map<string, Promise<*>>

	constructor(mailListId: Id, mailView: MailView) {

		this.listId = mailListId
		this.mailView = mailView
		this.mailsBeingBundled = new Map();

		this.list = new List({
			rowHeight: size.list_row_height,
			fetch: (start, count) => {
				return this._loadMailRange(start, count)
			},
			loadSingle: (elementId) => {
				return locator.entityClient.load(MailTypeRef, [this.listId, elementId]).catch(NotFoundError, (e) => {
					// we return null if the entity does not exist
				})
			},
			sortCompare: sortCompareByReverseId,
			elementSelected: (entities, elementClicked, selectionChanged, multiSelectionActive) => mailView.elementSelected(entities, elementClicked, selectionChanged, multiSelectionActive),
			createVirtualRow: () => new MailRow(false),
			showStatus: false,
			className: className,
			swipe: ({
				renderLeftSpacer: () => !logins.isInternalUserLoggedIn() ? [] : [
					m(Icon, {icon: Icons.Folder}),
					m(".pl-s", this.targetInbox() ? lang.get('received_action') : lang.get('archive_action'))
				],
				renderRightSpacer: () => [m(Icon, {icon: Icons.Folder}), m(".pl-s", lang.get('delete_action'))],
				swipeLeft: (listElement: Mail) => promptAndDeleteMails(locator.mailModel, [listElement], () => this.list.selectNone()),
				swipeRight: (listElement: Mail) => {
					if (!logins.isInternalUserLoggedIn()) {
						return Promise.resolve(false) // externals don't have an archive folder
					} else if (this.targetInbox()) {
						this.list.selectNone()
						return locator.mailModel.getMailboxFolders(listElement)
						              .then((folders) => moveMails(locator.mailModel, [listElement], getInboxFolder(folders)))
					} else {
						this.list.selectNone()
						return locator.mailModel.getMailboxFolders(listElement)
						              .then((folders) => moveMails(locator.mailModel, [listElement], getArchiveFolder(folders)))
					}
				},
				enabled: true
			}),
			elementsDraggable: true,
			multiSelectionAllowed: true,
			emptyMessage: lang.get("noMails_msg"),
			listLoadedCompletly: () => this._fixCounterIfNeeded(this.listId, this.list.getLoadedEntities().length),
			dragStart: (ev, row, selected: $ReadOnlyArray<Mail>) => {
				if (!ev.altKey) return false
				assertNotNull(document.body).style.cursor = "grabbing"
				console.log(this.mailsBeingBundled)

				// function onWindowLeft(e) {
				// 	if (!e.fromElement) {
				// 		assertNotNull(document.body).style.cursor = "no-drop"
				// 	}
				// }
				// window.addEventListener("dragleave", onWindowLeft)

				// TODO not sure if we can assert not null here? i dont think it's possible for the mail list to have an entry that is not a Mail
				const selectedMail = assertNotNull(row.entity)

				// If zero or one items are selected, then we should choose the one being dragged.
				// if multiple items are selected, then we include them + the one being dragged, if it's not already included
				// TODO should we have the row be automatically selected upon drag? This would have to happen in List, shouldn't be more complicated then adding the row into selectedEntities (i hope)
				const draggedMails = selected.length < 2
					? [selectedMail]
					: uniqueInsert(selected.slice(), selectedMail, haveSameId)

				const dragEndPromise = new Promise(resolve => {
					function onDragEnd() {
						document.removeEventListener("dragend", onDragEnd)
						resolve(false)
					}

					document.addEventListener("dragend", onDragEnd)
				})

				fileApp.queryAvailableMsg(draggedMails)
				       .then(notDownloaded => {
					       const notDownloadedMails =
						       draggedMails.filter(mail => notDownloaded.find(m => haveSameId(m, mail)))

					       const download = notDownloadedMails.length > 0
						       ? () =>
							       Promise.all(notDownloadedMails.map(mail => {
								       const downloadProgressMonitorHandle = locator.progressTracker.registerMonitor(1);
								       // If a mail was started downloading in the last drag, and we try to drag it again while it's not yet finished,
								       // then we should grab the promise that has already been created for it, otherwise make a new one
								       const id = mail._id.join()
								       console.log("mail if with id", id, (this.mailsBeingBundled.has(id) ? "already started" : "starting now"))
								       if (this.mailsBeingBundled.has(id)) {
									       return neverNull(this.mailsBeingBundled.get(id))
								       } else {
									       const progressMonitor = makeTrackedProgressMonitor(locator.progressTracker, 1)
									       const bundlePromise = bundleMail(mail)
										       .tap(() => progressMonitor.workDone(1))
										       .then(fileApp.saveBundleAsMsg)
										       .then(() => this.mailsBeingBundled.delete(id))
										       .then(() => {
											       console.log("completed!");
											       progressMonitor.workDone(1)
										       })
									       this.mailsBeingBundled.set(id, bundlePromise)
									       return bundlePromise
								       }

							       }))
							              .then(() => assertNotNull(document.body).style.cursor = "default")
							              .return(true)
						       : () => Promise.resolve(true)

					       Promise.race([download(), dragEndPromise])
					              .then(didComplete => {
						              ev.preventDefault()
						              console.log("race finished", ev)
						              // window.removeEventListener("dragleave", onWindowLeft)
						              if (didComplete) {
							              console.log("all ready")
							              fileApp.dragExportedMails(draggedMails.map(getLetId))
						              } else {
							              // Show progress in the UI
							              assertNotNull(document.body).style.cursor = "progress"
							              console.log("too fast!")
						              }
					              })
				       })
				return true
			}
		})
	}

	// Do not start many fixes in parallel, do check after some time when counters are more likely to settle
	_fixCounterIfNeeded: ((listId: Id, listLength: number) => void) = debounce(2000, (listId: Id, listLength: number) => {
		// If folders are changed, list won't have the data we need.
		// Do not rely on counters if we are not connected
		if (this.listId !== listId || worker.wsConnection()() !== "connected") {
			return
		}
		// If list was modified in the meantime, we cannot be sure that we will fix counters correctly (e.g. because of the inbox rules)
		if (listLength !== this.list.getLoadedEntities().length) {
			return
		}
		const unreadMails = this.list.getLoadedEntities().reduce((acc, mail) => {
			if (mail.unread) {
				acc++
			}
			return acc
		}, 0)
		locator.mailModel.getCounterValue(this.listId).then((counterValue) => {
			if (counterValue != null && counterValue !== unreadMails) {
				locator.mailModel.getMailboxDetailsForMailListId(this.listId).then((mailboxDetails) => {
					const data = createWriteCounterData({
						counterType: CounterType_UnreadMails,
						row: mailboxDetails.mailGroup._id,
						column: this.listId,
						value: String(unreadMails)
					})
					serviceRequestVoid(MonitorService.CounterService, HttpMethod.POST, data)
				})

			}
		})
	})

	view(): Children {
		// Save the folder before showing the dialog so that there's no chance that it will change
		const folder = this.mailView.selectedFolder
		const purgeButtonAttrs: ButtonAttrs = {
			label: "clearFolder_action",
			type: ButtonType.Primary,
			colors: ButtonColors.Nav,
			click: () => {
				if (folder == null) {
					console.warn("Cannot delete folder, no folder is selected")
					return
				}
				Dialog.confirm(() => lang.get("confirmDeleteFinallySystemFolder_msg", {"{1}": getFolderName(folder)}))
				      .then(confirmed => {
					      if (confirmed) {
						      this.mailView._finallyDeleteAllMailsInSelectedFolder(folder)
					      }
				      })
			}
		}

		return this.showingTrashOrSpamFolder()
			? m(".flex.flex-column.fill-absolute", [
				m(".flex.flex-column.justify-center.plr-l.list-border-right.list-bg.list-header", [
					m(".small.flex-grow.pt", lang.get("storageDeletion_msg")),
					m(".mr-negative-s.align-self-end", m(ButtonN, purgeButtonAttrs))
				]),
				m(".rel.flex-grow", m(this.list))
			])
			: m(this.list)
	}

	targetInbox(): boolean {
		if (this.mailView.selectedFolder) {
			return this.mailView.selectedFolder.folderType === MailFolderType.ARCHIVE
				|| this.mailView.selectedFolder.folderType === MailFolderType.TRASH
		} else {
			return false
		}
	}

	showingTrashOrSpamFolder(): boolean {
		if (this.mailView.selectedFolder) {
			return this.mailView.selectedFolder.folderType === MailFolderType.SPAM
				|| this.mailView.selectedFolder.folderType === MailFolderType.TRASH
		} else {
			return false
		}
	}

	_loadMailRange(start: Id, count: number): Promise<Mail[]> {
		return locator.entityClient.loadRange(MailTypeRef, this.listId, start, count, true).then(mails => {
			return locator.mailModel.getMailboxDetailsForMailListId(this.listId).then((mailboxDetail) => {
				if (isInboxList(mailboxDetail, this.listId)) {
					// filter emails
					return Promise.filter(mails, (mail) => {
						return findAndApplyMatchingRule(worker, locator.entityClient, mailboxDetail, mail, true)
							.then(matchingMailId => !matchingMailId)
					}).then(inboxMails => {
						if (mails.length === count && inboxMails.length < mails.length) {
							//console.log("load more because of matching inbox rules")
							return this._loadMailRange(mails[mails.length - 1]._id[1], mails.length - inboxMails.length)
							           .then(filteredMails => {
								           return inboxMails.concat(filteredMails)
							           })
						}
						return inboxMails
					})
				} else {
					return mails
				}
			})
		})
	}
}


