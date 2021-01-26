// @flow

import {create, TypeRef} from "../../common/utils/EntityUtils"

import type {EmailTemplateContent} from "./EmailTemplateContent"

export const EmailTemplateTypeRef: TypeRef<EmailTemplate> = new TypeRef("tutanota", "EmailTemplate")
export const _TypeModel: TypeModel = {
	"name": "EmailTemplate",
	"since": 45,
	"type": "LIST_ELEMENT_TYPE",
	"id": 1157,
	"rootId": "CHR1dGFub3RhAASF",
	"versioned": false,
	"encrypted": true,
	"values": {
		"_format": {
			"id": 1161,
			"type": "Number",
			"cardinality": "One",
			"final": false,
			"encrypted": false
		},
		"_id": {
			"id": 1159,
			"type": "GeneratedId",
			"cardinality": "One",
			"final": true,
			"encrypted": false
		},
		"_ownerEncSessionKey": {
			"id": 1163,
			"type": "Bytes",
			"cardinality": "ZeroOrOne",
			"final": true,
			"encrypted": false
		},
		"_ownerGroup": {
			"id": 1162,
			"type": "GeneratedId",
			"cardinality": "ZeroOrOne",
			"final": true,
			"encrypted": false
		},
		"_permissions": {
			"id": 1160,
			"type": "GeneratedId",
			"cardinality": "One",
			"final": true,
			"encrypted": false
		},
		"tag": {
			"id": 1165,
			"type": "String",
			"cardinality": "One",
			"final": false,
			"encrypted": true
		},
		"title": {
			"id": 1164,
			"type": "String",
			"cardinality": "One",
			"final": false,
			"encrypted": true
		}
	},
	"associations": {
		"contents": {
			"id": 1166,
			"type": "AGGREGATION",
			"cardinality": "Any",
			"final": false,
			"refType": "EmailTemplateContent"
		}
	},
	"app": "tutanota",
	"version": "45"
}

export function createEmailTemplate(values?: $Shape<$Exact<EmailTemplate>>): EmailTemplate {
	return Object.assign(create(_TypeModel, EmailTemplateTypeRef), values)
}

export type EmailTemplate = {
	_type: TypeRef<EmailTemplate>;
	_errors: Object;

	_format: NumberString;
	_id: IdTuple;
	_ownerEncSessionKey: ?Uint8Array;
	_ownerGroup: ?Id;
	_permissions: Id;
	tag: string;
	title: string;

	contents: EmailTemplateContent[];
}