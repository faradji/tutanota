// @flow
import type {WebContentsEvent} from "electron"
import {lang} from "../misc/LanguageViewModel"
import type {WindowManager} from "./DesktopWindowManager.js"
import {defer, objToError} from '../api/common/utils/Utils.js'
import type {DeferredObject} from "../api/common/utils/Utils"
import {downcast, neverNull, noOp} from "../api/common/utils/Utils"
import {errorToObj} from "../api/common/WorkerProtocol"
import type {DesktopConfig} from "./config/DesktopConfig"
import type {DesktopSseClient} from './sse/DesktopSseClient.js'
import type {DesktopNotifier} from "./DesktopNotifier"
import type {Socketeer} from "./Socketeer"
import type {DesktopAlarmStorage} from "./sse/DesktopAlarmStorage"
import type {DesktopCryptoFacade} from "./DesktopCryptoFacade"
import type {DesktopDownloadManager} from "./DesktopDownloadManager"
import type {SseInfo} from "./sse/DesktopSseClient"
import {base64ToUint8Array} from "../api/common/utils/Encoding"
import type {ElectronUpdater} from "./ElectronUpdater"
import {DesktopConfigKey} from "./config/ConfigKeys";
import {log} from "./DesktopLog";
import type {DesktopUtils} from "./DesktopUtils"
import type {DesktopErrorHandler} from "./DesktopErrorHandler"
import type {DesktopIntegrator} from "./integration/DesktopIntegrator"
import {mailIdToFileName, makeMsgFile, msgFileExists, writeFilesToTmp} from "./DesktopFileExport"
import type {Mail} from "../api/entities/tutanota/Mail"
import {fileExists} from "./PathUtils"
import {mapAndFilterNullAsync} from "../api/common/utils/ArrayUtils"

/**
 * node-side endpoint for communication between the renderer threads and the node thread
 */
export class IPC {
	_conf: DesktopConfig;
	_sse: DesktopSseClient;
	_wm: WindowManager;
	_notifier: DesktopNotifier;
	_sock: Socketeer;
	_alarmStorage: DesktopAlarmStorage;
	_crypto: DesktopCryptoFacade;
	_dl: DesktopDownloadManager;
	_initialized: Array<DeferredObject<void>>;
	_requestId: number = 0;
	_queue: {[string]: Function};
	_updater: ?ElectronUpdater;
	_electron: $Exports<"electron">;
	_desktopUtils: DesktopUtils;
	_err: DesktopErrorHandler;
	_integrator: DesktopIntegrator;

	constructor(
		conf: DesktopConfig,
		notifier: DesktopNotifier,
		sse: DesktopSseClient,
		wm: WindowManager,
		sock: Socketeer,
		alarmStorage: DesktopAlarmStorage,
		desktopCryptoFacade: DesktopCryptoFacade,
		dl: DesktopDownloadManager,
		updater: ?ElectronUpdater,
		electron: $Exports<"electron">,
		desktopUtils: DesktopUtils,
		errorHandler: DesktopErrorHandler,
		integrator: DesktopIntegrator,
	) {
		this._conf = conf
		this._sse = sse
		this._wm = wm
		this._notifier = notifier
		this._sock = sock
		this._alarmStorage = alarmStorage
		this._crypto = desktopCryptoFacade
		this._dl = dl
		this._updater = updater
		this._electron = electron
		this._desktopUtils = desktopUtils
		this._err = errorHandler
		this._integrator = integrator
		if (!!this._updater) {
			this._updater.setUpdateDownloadedListener(() => {
				this._wm.getAll().forEach(w => this.sendRequest(w.id, 'appUpdateDownloaded', []))
			})
		}

		this._initialized = []
		this._queue = {}
		this._err = errorHandler
		this._electron.ipcMain.handle('to-main', (ev: WebContentsEvent, request: any) => {
			const senderWindow = this._wm.getEventSender(ev)
			if(!senderWindow) return // no one is listening anymore
			const windowId = senderWindow.id
			if (request.type === "response") {
				this._queue[request.id](null, request.value);
			} else if (request.type === "requestError") {
				this._queue[request.id](objToError((request: any).error), null)
				delete this._queue[request.id]
			} else {
				this._invokeMethod(windowId, request.type, request.args)
				    .then(result => {
					    const response = {
						    id: request.id,
						    type: "response",
						    value: result,
					    }
					    const w = this._wm.get(windowId)
					    if (w) w.sendMessageToWebContents(response)
				    })
				    .catch((e) => {
					    const response = {
						    id: request.id,
						    type: "requestError",
						    error: errorToObj(e),
					    }
					    const w = this._wm.get(windowId)
					    if (w) w.sendMessageToWebContents(response)
				    })
			}
		})
	}

	async _invokeMethod(windowId: number, method: NativeRequestType, args: Array<Object>): any {

		switch (method) {
			case 'init':
				this._initialized[windowId].resolve()
				return Promise.resolve(process.platform)
			case 'findInPage':
				return this.initialized(windowId).then(() => {
					const w = this._wm.get(windowId)
					if (w) {
						// findInPage might reject if requests come too quickly
						// if it's rejecting for another reason we'll have logs
						return w.findInPage(args)
						        .catch(e => log.debug("findInPage reject:", args, e))
					} else {
						return {numberOfMatches: 0, currentMatch: 0}
					}
				})
			case 'stopFindInPage':
				return this.initialized(windowId).then(() => {
					const w = this._wm.get(windowId)
					if (w) {
						w.stopFindInPage()
					}
				}).catch(noOp)
			case 'setSearchOverlayState': {
				const w = this._wm.get(windowId)
				if (w) {
					const state: boolean = downcast(args[0])
					const force: boolean = downcast(args[1])
					w.setSearchOverlayState(state, force)
				}
				return Promise.resolve()
			}
			case 'registerMailto':
				return this._desktopUtils.registerAsMailtoHandler(true)
			case 'unregisterMailto':
				return this._desktopUtils.unregisterAsMailtoHandler(true)
			case 'integrateDesktop':
				return this._integrator.integrate()
			case 'unIntegrateDesktop':
				return this._integrator.unintegrate()
			case 'sendDesktopConfig':
				return Promise.all([
					this._desktopUtils.checkIsMailtoHandler(),
					this._integrator.isAutoLaunchEnabled(),
					this._integrator.isIntegrated()
				]).then(([isMailtoHandler, autoLaunchEnabled, isIntegrated]) => {
					const config = this._conf.getVar()
					config.isMailtoHandler = isMailtoHandler
					config.runOnStartup = autoLaunchEnabled
					config.isIntegrated = isIntegrated
					config.updateInfo = !!this._updater
						? this._updater.updateInfo
						: null
					return config
				})
			case 'openFileChooser':
				if (args[1]) { // open folder dialog
					return this._electron.dialog.showOpenDialog(null, {properties: ['openDirectory']}).then(({filePaths}) => filePaths)
				} else { // open file
					return Promise.resolve([])
				}
			case 'open':
				// itemPath, mimeType
				const itemPath = args[0].toString()
				return this._dl.open(itemPath)
			case 'download':
				// sourceUrl, filename, headers
				return this._dl.downloadNative(...args.slice(0, 3))
			case 'saveBlob':
				// args: [data.name, uint8ArrayToBase64(data.data)]
				const filename: string = downcast(args[0])
				const data: Uint8Array = base64ToUint8Array(downcast(args[1]))
				return this._dl.saveBlob(filename, data, neverNull(this._wm.get(windowId)))
			case "aesDecryptFile":
				// key, path
				return this._crypto.aesDecryptFile(...args.slice(0, 2))
			case 'updateDesktopConfig':
				return this._conf.setVar('any', args[0])
			case 'openNewWindow':
				this._wm.newWindow(true)
				return Promise.resolve()
			case 'enableAutoLaunch':
				return this._integrator.enableAutoLaunch()
			case 'disableAutoLaunch':
				return this._integrator.disableAutoLaunch()
			case 'getPushIdentifier':
				const uInfo = {
					userId: args[0].toString(),
					mailAddress: args[1].toString()
				}
				// we know there's a logged in window
				// first, send error report if there is one
				return this._err.sendErrorReport(windowId)
				           .then(() => {
					           const w = this._wm.get(windowId)
					           if (!w) return
					           w.setUserInfo(uInfo)
					           if (!w.isHidden()) {
						           this._notifier.resolveGroupedNotification(uInfo.userId)
					           }
					           const sseInfo = this._sse.getPushIdentifier()
					           return sseInfo && sseInfo.identifier
				           })
			case 'storePushIdentifierLocally':
				return Promise.all([
					this._sse.storePushIdentifier(
						args[0].toString(),
						args[1].toString(),
						args[2].toString()
					),
					this._alarmStorage.storePushIdentifierSessionKey(
						args[3].toString(),
						args[4].toString()
					)
				]).then(() => {})
			case 'initPushNotifications':
				// Nothing to do here because sse connection is opened when starting the native part.
				return Promise.resolve()
			case 'closePushNotifications':
				// only gets called in the app
				// the desktop client closes notifications on window focus
				return Promise.resolve()
			case 'sendSocketMessage':
				// for admin client integration
				this._sock.sendSocketMessage(args[0])
				return Promise.resolve()
			case 'getLog':
				return Promise.resolve(global.logger.getEntries())
			case 'changeLanguage':
				return lang.setLanguage(args[0])
			case 'manualUpdate':
				return !!this._updater
					? this._updater.manualUpdate()
					: Promise.resolve(false)
			case 'isUpdateAvailable':
				return !!this._updater
					? Promise.resolve(this._updater.updateInfo)
					: Promise.resolve(null)
			case 'mailBundleExport': {
				const bundles = args[0]
				const files = await Promise.all(bundles.map(makeMsgFile))
				const dir = await writeFilesToTmp(files)
				// TODO: Are we able to select the files as well?
				// it's possible to do so with shell.showFileInFolder but that only works for one file
				// we dont do the open export here, we just save them to the export dir
				// this._electron.shell.openPath(dir)
				return
			}
			case 'queryAvailableMsgs': {
				const mails: Array<Mail> = args[0]
				// return all mails that havent already been exported
				return mapAndFilterNullAsync(mails, mail => msgFileExists(mail._id)
					.then(exists => exists ? null : mail))
			}
			case 'dragExportedMails': {
				const ids: Array<IdTuple> = args[0]

				const startDrag = files => {
					this._wm.get(windowId)?._browserWindow.webContents.startDrag({
						files,
						icon: this._electron.nativeImage.createFromDataURL("data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiIHN0YW5kYWxvbmU9Im5vIj8+CjxzdmcKICAgeG1sbnM6ZGM9Imh0dHA6Ly9wdXJsLm9yZy9kYy9lbGVtZW50cy8xLjEvIgogICB4bWxuczpjYz0iaHR0cDovL2NyZWF0aXZlY29tbW9ucy5vcmcvbnMjIgogICB4bWxuczpyZGY9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkvMDIvMjItcmRmLXN5bnRheC1ucyMiCiAgIHhtbG5zOnN2Zz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciCiAgIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyIKICAgeG1sbnM6eGxpbms9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkveGxpbmsiCiAgIHhtbG5zOnNvZGlwb2RpPSJodHRwOi8vc29kaXBvZGkuc291cmNlZm9yZ2UubmV0L0RURC9zb2RpcG9kaS0wLmR0ZCIKICAgeG1sbnM6aW5rc2NhcGU9Imh0dHA6Ly93d3cuaW5rc2NhcGUub3JnL25hbWVzcGFjZXMvaW5rc2NhcGUiCiAgIHZpZXdCb3g9IjAgMCAyOTkuOTk5OTkgMzAwIgogICBpZD0ic3ZnMiIKICAgdmVyc2lvbj0iMS4xIgogICBpbmtzY2FwZTp2ZXJzaW9uPSIwLjkxIHIxMzcyNSIKICAgc29kaXBvZGk6ZG9jbmFtZT0ibG9nby1mYXZpY29uLnN2ZyIKICAgd2lkdGg9IjMwMCIKICAgaGVpZ2h0PSIzMDAiPgogIDxtZXRhZGF0YQogICAgIGlkPSJtZXRhZGF0YTM4Ij4KICAgIDxyZGY6UkRGPgogICAgICA8Y2M6V29yawogICAgICAgICByZGY6YWJvdXQ9IiI+CiAgICAgICAgPGRjOmZvcm1hdD5pbWFnZS9zdmcreG1sPC9kYzpmb3JtYXQ+CiAgICAgICAgPGRjOnR5cGUKICAgICAgICAgICByZGY6cmVzb3VyY2U9Imh0dHA6Ly9wdXJsLm9yZy9kYy9kY21pdHlwZS9TdGlsbEltYWdlIiAvPgogICAgICAgIDxkYzp0aXRsZT48L2RjOnRpdGxlPgogICAgICA8L2NjOldvcms+CiAgICA8L3JkZjpSREY+CiAgPC9tZXRhZGF0YT4KICA8ZGVmcwogICAgIGlkPSJkZWZzMzYiIC8+CiAgPHNvZGlwb2RpOm5hbWVkdmlldwogICAgIHBhZ2Vjb2xvcj0iI2ZmZmZmZiIKICAgICBib3JkZXJjb2xvcj0iIzY2NjY2NiIKICAgICBib3JkZXJvcGFjaXR5PSIxIgogICAgIG9iamVjdHRvbGVyYW5jZT0iMTAiCiAgICAgZ3JpZHRvbGVyYW5jZT0iMTAiCiAgICAgZ3VpZGV0b2xlcmFuY2U9IjEwIgogICAgIGlua3NjYXBlOnBhZ2VvcGFjaXR5PSIwIgogICAgIGlua3NjYXBlOnBhZ2VzaGFkb3c9IjIiCiAgICAgaW5rc2NhcGU6d2luZG93LXdpZHRoPSIxOTIwIgogICAgIGlua3NjYXBlOndpbmRvdy1oZWlnaHQ9IjEwMTYiCiAgICAgaWQ9Im5hbWVkdmlldzM0IgogICAgIHNob3dncmlkPSJmYWxzZSIKICAgICBmaXQtbWFyZ2luLXRvcD0iMCIKICAgICBmaXQtbWFyZ2luLWxlZnQ9IjAiCiAgICAgZml0LW1hcmdpbi1yaWdodD0iMCIKICAgICBmaXQtbWFyZ2luLWJvdHRvbT0iMCIKICAgICBpbmtzY2FwZTp6b29tPSIxLjk0Mzc1IgogICAgIGlua3NjYXBlOmN4PSI4NS4zNDI0NiIKICAgICBpbmtzY2FwZTpjeT0iMTM3Ljg1MjI5IgogICAgIGlua3NjYXBlOndpbmRvdy14PSIwIgogICAgIGlua3NjYXBlOndpbmRvdy15PSIyNyIKICAgICBpbmtzY2FwZTp3aW5kb3ctbWF4aW1pemVkPSIxIgogICAgIGlua3NjYXBlOmN1cnJlbnQtbGF5ZXI9InN2ZzIiIC8+CiAgPGcKICAgICBpZD0iZzI0IgogICAgIHN0eWxlPSJmaWxsOiNhMDFlMjAiCiAgICAgdHJhbnNmb3JtPSJtYXRyaXgoMS4xNjc2NzExLDAsMCwxLjE2NzY3MTEsLTE1NC44OTY0NCwtMjQ4LjIyNzIyKSI+CiAgICA8ZGVmcwogICAgICAgaWQ9ImRlZnMyNiI+CiAgICAgIDxwYXRoCiAgICAgICAgIGQ9Im0gMTU1LjUwMywyMjIuNzk5IGMgLTEyLjY0LDAgLTIyLjg3NSwxMC4yNDYgLTIyLjg3NSwyMi44NzIgbCAwLDIxMS4yMyBjIDAsMC44MDEgMC4wNDYsMS42MDggMC4xMjMsMi4zODggOC41LC0zLjE2NyAxNy41MjQsLTYuNjI5IDI3LjA1NCwtMTAuNDM2IDY2LjMzNiwtMjYuNDggMTIwLjU2OSwtNDguOTk0IDEyMC42MTgsLTc0LjQxNSAwLC0wLjgxNCAtMC4wNTYsLTEuNjM2IC0wLjE3MiwtMi40NTggLTMuNDMsLTI1LjA5OCAtNjMuNDA3LC0zMi44NzkgLTYzLjMyNCwtNDQuMzgxIDAuMDA3LC0wLjYxMSAwLjE4LC0xLjI1IDAuNTQ4LC0xLjg4OSA3LjIwNSwtMTIuNjE5IDM1Ljc0MywtMTIuMDE1IDQ2LjI1MywtMTIuOTA3IDEwLjUxOSwtMC45MTMgMzUuMjA2LC0wLjcyNCAzNi4zOTksLTguMjQ0IDAuMDM1LC0wLjIzMiAwLjA1NywtMC40NjMgMC4wNTcsLTAuNjk1IDAuMDI4LC02Ljk4NyAtMTYuOTc3LC05LjcyNiAtMTYuOTc3LC05LjcyNiAwLDAgMjAuNjM1LDMuMDgzIDIwLjU3OSwxMS4xMSAwLDAuMzkzIC0wLjA0OCwwLjggLTAuMTU4LDEuMjE0IC0yLjIyMiw4LjYyNCAtMjAuMzc5LDEwLjI0NiAtMzIuMzg2LDEwLjgzNSAtMTEuMzU2LDAuNTY5IC0yOC42NDgsMS44NjEgLTI4LjcwNyw3LjQwOCAtMC4wMDcsMC4zMjMgMC4wNDksMC42NiAwLjE2NSwxLjAwNCAyLjcxLDguMTEgNjYuMDksMTIuMDE1IDEwNi42NCwzMy4wNjEgMjMuMzM1LDEyLjA5OSAzNC45NCwzMi40MjIgNDAuMjYzLDUzLjQxOCBsIDAsLTE2Ni41MiBjIDAsLTEyLjYyNiAtMTAuMjQzLC0yMi44NzIgLTIyLjg2OSwtMjIuODcyIGwgLTIxMS4yMzEsMCB6IgogICAgICAgICBpZD0iYSIKICAgICAgICAgaW5rc2NhcGU6Y29ubmVjdG9yLWN1cnZhdHVyZT0iMCIgLz4KICAgIDwvZGVmcz4KICAgIDxjbGlwUGF0aAogICAgICAgaWQ9ImIiPgogICAgICA8dXNlCiAgICAgICAgIGhlaWdodD0iODAwIgogICAgICAgICB3aWR0aD0iMTI4MCIKICAgICAgICAgb3ZlcmZsb3c9InZpc2libGUiCiAgICAgICAgIHhsaW5rOmhyZWY9IiNhIgogICAgICAgICBpZD0idXNlMzAiCiAgICAgICAgIHN0eWxlPSJvdmVyZmxvdzp2aXNpYmxlIgogICAgICAgICB4PSIwIgogICAgICAgICB5PSIwIiAvPgogICAgPC9jbGlwUGF0aD4KICAgIDxwYXRoCiAgICAgICBjbGlwLXBhdGg9InVybCgjYikiCiAgICAgICBkPSJtIDEzMi42MjcsMjIyLjc5OSAyNTYuOTc1LDAgMCwyMzYuNDkgLTI1Ni45NzUsMCB6IgogICAgICAgaWQ9InBhdGgzMiIKICAgICAgIGlua3NjYXBlOmNvbm5lY3Rvci1jdXJ2YXR1cmU9IjAiIC8+CiAgPC9nPgo8L3N2Zz4K")
					})
				}

				return Promise.all(ids.map(id => mailIdToFileName(id, ".msg")).filter(fileExists))
				              .then(startDrag)
			}
			default:
				return Promise.reject(new Error(`Invalid Method invocation: ${method}`))
		}
	}

	sendRequest(windowId: number, type: JsRequestType, args: Array<any>): Promise<Object> {
		return this.initialized(windowId).then(() => {
			const requestId = this._createRequestId();
			const request = {
				id: requestId,
				type: type,
				args: args,
			}
			const w = this._wm.get(windowId)
			if (w) {
				w.sendMessageToWebContents(request)
			}
			return new Promise((resolve, reject) => {
				this._queue[requestId] = (err, result) => err ? reject(err) : resolve(result)
			})
		})
	}

	_createRequestId(): string {
		if (this._requestId >= Number.MAX_SAFE_INTEGER) {
			this._requestId = 0
		}
		return "desktop" + this._requestId++
	}

	initialized(windowId: number): Promise<void> {
		if (this._initialized[windowId]) {
			return this._initialized[windowId].promise
		} else {
			return Promise.reject(new Error("Tried to call ipc function on nonexistent window"))
		}
	}

	addWindow(id: number) {
		this._initialized[id] = defer()

		const sseValueListener = (value: ?SseInfo) => {
			if (value && value.userIds.length === 0) {
				log.debug("invalidating alarms for window", id)
				this.sendRequest(id, "invalidateAlarms", [])
				    .catch((e) => {
					    log.debug("Could not invalidate alarms for window ", id, e)
					    this._conf.removeListener(DesktopConfigKey.pushIdentifier, sseValueListener)
				    })
			}
		}
		this._conf.on(DesktopConfigKey.pushIdentifier, sseValueListener, true)
	}

	removeWindow(id: number) {
		delete this._initialized[id]
	}
}
