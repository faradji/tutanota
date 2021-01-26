// @flow

import {create, TypeRef} from "../../common/utils/EntityUtils"


export const EmailTemplateContentTypeRef: TypeRef<EmailTemplateContent> = new TypeRef("tutanota", "EmailTemplateContent")
export const _TypeModel: TypeModel = {
	"name": "EmailTemplateContent",
	"since": 45,
	"type": "AGGREGATED_TYPE",
	"id": 1153,
	"rootId": "CHR1dGFub3RhAASB",
	"versioned": false,
	"encrypted": false,
	"values": {
		"_id": {
			"id": 1154,
			"type": "CustomId",
			"cardinality": "One",
			"final": true,
			"encrypted": false
		},
		"languageCode": {
			"id": 1156,
			"type": "String",
			"cardinality": "One",
			"final": false,
			"encrypted": true
		},
		"text": {
			"id": 1155,
			"type": "String",
			"cardinality": "One",
			"final": false,
			"encrypted": true
		}
	},
	"associations": {},
	"app": "tutanota",
	"version": "45"
}

export function createEmailTemplateContent(values?: $Shape<$Exact<EmailTemplateContent>>): EmailTemplateContent {
	return Object.assign(create(_TypeModel, EmailTemplateContentTypeRef), values)
}

export type EmailTemplateContent = {
	_type: TypeRef<EmailTemplateContent>;

	_id: Id;
	languageCode: string;
	text: string;
}