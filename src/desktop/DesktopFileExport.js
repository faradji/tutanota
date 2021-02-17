// @flow
import path from "path"
import {legalizeFilenames} from "../api/common/utils/FileUtils"
import type {ValidExtension} from "./PathUtils"
import {fileExists, isReservedFilename} from "./PathUtils"
import {promises as fs} from "fs"
import type {MailBundle} from "../mail/export/Bundler"
import {app} from 'electron'
import {Attachment, Email, MessageEditorFormat} from "oxmsg"
import {downcast} from "../api/common/utils/Utils"

export async function getExportDirectoryPath(): Promise<string> {
	const dirPath = path.join(app.getPath('temp'), 'tutanota', 'msg_export')
	await fs.mkdir(dirPath, {recursive: true})
	return dirPath
}

/**
 * Writes files to a new dir in tmp
 * @param dirPath
 * @param files Array of named content to write to tmp
 * @returns {string} path to the directory in which the files were written
 * */
// TODO The files are no longer being deleted, as we need them to persist in order for the user to be able to presented them
// in their file explorer of choice. Do we need to set up some hook to delete it all later? or should we just count on the OS
// to do it's thing
export async function writeFiles(dirPath: string, files: Array<{name: string, content: Uint8Array}>): Promise<string> {
	const legalNames = legalizeFilenames(files.map(f => f.name), isReservedFilename)
	const legalFiles = files.map(f => ({
		content: f.content,
		name: legalNames[f.name].shift()
	}))
	for (let file of legalFiles) {
		await fs.writeFile(path.join(dirPath, file.name), file.content)
	}
	return dirPath
}

export async function writeFile(dirPath: string, file: {name: string, content: Uint8Array}): Promise<string> {
	const legalName = legalizeFilenames([file.name], isReservedFilename)[file.name][0]
	const fullPath = path.join(dirPath, legalName)
	await fs.writeFile(fullPath, file.content)
	return fullPath
}

export async function makeMsgFile(bundle: MailBundle): Promise<{name: string, content: Uint8Array}> {
	const subject = `[Tutanota] ${bundle.subject}`
	const email = new Email(bundle.isDraft, bundle.isRead)
		.subject(subject)
		.bodyHtml(bundle.body)
		.bodyFormat(MessageEditorFormat.EDITOR_FORMAT_HTML)
		.sender(bundle.sender.address, bundle.sender.name)
		.tos(bundle.to)
		.ccs(bundle.cc)
		.bccs(bundle.bcc)
		.replyTos(bundle.replyTo)
		.sentOn(new Date(bundle.sentOn))
		.receivedOn(new Date(bundle.receivedOn))
		.headers(bundle.headers || "")
	for (let attachment of bundle.attachments) {
		// When the MailBundle gets passed over via the IPC it loses some of it's type information. the Uint8Arrays stored in the
		// attachment DataFiles cease to be Uint8Arrays and just because regular arrays, thus we have to remake them here.
		// Oxmsg currently doesn't accept regular arrays for binary data, only Uint8Arrays, strings and booleans
		// we could change the Oxmsg behaviour, it's kind of nice for it to be strict though.
		email.attach(new Attachment(new Uint8Array(attachment.data), attachment.name, attachment.cid || ""))
	}

	return {name: mailIdToFileName(bundle.mailId, "msg"), content: email.msg()}
}


export async function msgFileExists(id: IdTuple): Promise<boolean> {
	const exportDir = await getExportDirectoryPath()

	// successful call to stat means the file exists. it should be valid because the only reason it's there is because we made it
	const exists = await fileExists(path.join(exportDir, mailIdToFileName(id, "msg")))
	return exists
}

const idDelimiter = "__"

/**
 * Get a suitable filename from a mail id
 * @param id
 * @param extension: file extension without the leading dot
 * @returns {string}
 */
export function mailIdToFileName(id: IdTuple, extension: ValidExtension): string {
	return id.join(idDelimiter) + (extension && `.${extension}`)
}

export function fileNameToMailId(filename: string): IdTuple {
	if (filename === "") throw new Error("Can't extract IdTuple from empty string")

	const parts = filename.split(".") // separate from the extension then split on the delimiter
	const id = parts[0].split(idDelimiter)
	if (id.length !== 2) throw new Error("Invalid mail id string")

	return downcast(id)
}