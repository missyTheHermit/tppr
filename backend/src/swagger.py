from flask import Blueprint, jsonify
from flask_swagger_ui import get_swaggerui_blueprint
from settings import PRODUCTION, PUBLIC_API_DOCS

swagger_bp = Blueprint("swagger", __name__)
SWAGGER_URL = "/api/docs"
API_URL = "/swagger.json"


def ref(schema_name):
    return {"$ref": f"#/components/schemas/{schema_name}"}


def array_of(schema_name):
    return {"type": "array", "items": ref(schema_name)}


def json_content(schema):
    return {"application/json": {"schema": schema}}


def json_request_body(schema, required=True, description=None):
    body = {
        "required": required,
        "content": json_content(schema),
    }
    if description:
        body["description"] = description
    return body


def form_request_body(fields, required=None):
    required = required or []
    return {
        "required": True,
        "content": {
            "application/x-www-form-urlencoded": {
                "schema": {
                    "type": "object",
                    "properties": fields,
                    "required": required,
                }
            }
        },
    }


def response(description, schema=None):
    result = {"description": description}
    if schema is not None:
        result["content"] = json_content(schema)
    return result


def message_response(description):
    return response(description, ref("Message"))


def error_response(description):
    return response(description, ref("Error"))


def pagination_parameters():
    return [
        {
            "name": "q",
            "in": "query",
            "schema": {"type": "string"},
            "description": "Search term matched against paper title or subject.",
        },
        {
            "name": "subject",
            "in": "query",
            "schema": {"type": "string"},
        },
        {
            "name": "source",
            "in": "query",
            "schema": {"type": "string", "enum": ["hsc", "trial", "internal", "practice", "custom"]},
        },
        {
            "name": "course_level",
            "in": "query",
            "schema": {
                "type": "string",
                "enum": ["standard", "advanced", "extension_1", "extension_2"],
            },
        },
        {
            "name": "year",
            "in": "query",
            "schema": {"type": "integer"},
        },
        {
            "name": "page",
            "in": "query",
            "schema": {"type": "integer", "minimum": 1, "default": 1},
        },
        {
            "name": "per_page",
            "in": "query",
            "schema": {"type": "integer", "minimum": 1, "default": 20},
        },
    ]


def paper_id_parameter():
    return {
        "name": "paper_id",
        "in": "path",
        "required": True,
        "schema": {"type": "string"},
    }


def asset_id_parameter():
    return {
        "name": "asset_id",
        "in": "path",
        "required": True,
        "schema": {"type": "string", "pattern": "^[A-Za-z0-9_-]{8,128}$"},
    }


def question_id_parameter():
    return {
        "name": "question_id",
        "in": "path",
        "required": True,
        "schema": {"type": "string"},
    }


def attempt_id_parameter():
    return {
        "name": "attempt_id",
        "in": "path",
        "required": True,
        "schema": {"type": "string"},
    }


def friendship_id_parameter():
    return {
        "name": "friendship_id",
        "in": "path",
        "required": True,
        "schema": {"type": "integer"},
    }


def user_id_path_parameter(name="user_id"):
    return {
        "name": name,
        "in": "path",
        "required": True,
        "schema": {"type": "string"},
    }


def report_id_parameter():
    return {
        "name": "report_id",
        "in": "path",
        "required": True,
        "schema": {"type": "integer"},
    }


def multipart_request_body(fields, required=None):
    required = required or []
    return {
        "required": True,
        "content": {
            "multipart/form-data": {
                "schema": {
                    "type": "object",
                    "properties": fields,
                    "required": required,
                }
            }
        },
    }


def binary_response(description, content_type="application/octet-stream"):
    return {
        "description": description,
        "content": {
            content_type: {
                "schema": {"type": "string", "format": "binary"}
            }
        },
    }


@swagger_bp.route(API_URL)
def swagger_json():
    return jsonify(
        {
            "openapi": "3.0.3",
            "info": {
                "title": "tppr-backend",
                "version": "0.1.0",
                "description": "Backend API for Thribhu's Past Paper Repository.",
            },
            "servers": [{"url": "/"}],
            "tags": [
                {"name": "System", "description": "Health checks and API metadata."},
                {"name": "Authentication", "description": "Supabase identity and session validation."},
                {"name": "Account", "description": "Local account profile and 2FA management."},
                {"name": "Papers", "description": "Past paper search, authoring, publishing, and remixing."},
                {"name": "Assets", "description": "Paper image asset upload and retrieval."},
                {"name": "Admin", "description": "Admin verification and takedown moderation."},
                {"name": "Progress", "description": "Study attempts, question timing, and completion stats."},
                {"name": "Stats", "description": "Student stats for dashboards and admin views."},
                {"name": "Social", "description": "Presence, friends, profiles, and leaderboards."},
                {"name": "Stars", "description": "Saved papers and per-paper star status."},
                {"name": "Reports", "description": "Paper reports and admin report review."},
            ],
            "components": {
                "securitySchemes": {
                    "bearerAuth": {
                        "type": "http",
                        "scheme": "bearer",
                        "bearerFormat": "Supabase JWT",
                    },
                    "apiKeyAuth": {
                        "type": "apiKey",
                        "in": "header",
                        "name": "X-API-Key",
                    }
                },
                "schemas": {
                    "Message": {
                        "type": "object",
                        "properties": {"message": {"type": "string"}},
                        "required": ["message"],
                    },
                    "Error": {
                        "type": "object",
                        "properties": {
                            "message": {"type": "string"},
                            "cause": {"type": "string"},
                        },
                        "required": ["message"],
                    },
                    "User": {
                        "type": "object",
                        "properties": {
                            "user_id": {"type": "string"},
                            "username": {"type": "string"},
                            "email": {"type": "string", "format": "email"},
                            "avatar_url": {"type": "string", "nullable": True},
                        },
                        "required": ["user_id", "username", "email"],
                    },
                    "WhoAmI": {
                        "allOf": [
                            ref("User"),
                            {
                                "type": "object",
                                "properties": {
                                    "totp_enabled": {"type": "boolean"},
                                    "admin": {"type": "boolean"},
                                    "admin_available": {"type": "boolean"},
                                },
                                "required": ["totp_enabled", "admin", "admin_available"],
                            },
                        ]
                    },
                    "AvatarUpdateResult": {
                        "type": "object",
                        "properties": {"avatar_url": {"type": "string"}},
                        "required": ["avatar_url"],
                    },
                    "AuthSuccess": {
                        "type": "object",
                        "properties": {
                            "message": {"type": "string"},
                            "requires_2fa": {"type": "boolean"},
                            "user": ref("User"),
                        },
                        "required": ["message", "requires_2fa", "user"],
                    },
                    "RegisterTwoFactorRequired": {
                        "type": "object",
                        "properties": {
                            "message": {"type": "string"},
                            "user_id": {"type": "string"},
                            "requires_2fa": {"type": "boolean"},
                            "totp_secret": {"type": "string"},
                            "provisioning_uri": {"type": "string"},
                            "qr_code": {"type": "string", "description": "Data URL containing a PNG QR code."},
                        },
                        "required": [
                            "message",
                            "user_id",
                            "requires_2fa",
                            "totp_secret",
                            "provisioning_uri",
                            "qr_code",
                        ],
                    },
                    "TwoFactorSetup": {
                        "type": "object",
                        "properties": {
                            "message": {"type": "string"},
                            "totp_secret": {"type": "string"},
                            "provisioning_uri": {"type": "string"},
                            "qr_code": {"type": "string", "description": "Data URL containing a PNG QR code."},
                        },
                        "required": ["message", "totp_secret", "provisioning_uri", "qr_code"],
                    },
                    "VerifyTwoFactorSuccess": {
                        "type": "object",
                        "properties": {
                            "message": {"type": "string"},
                            "user": ref("User"),
                        },
                        "required": ["message", "user"],
                    },
                    "TextBlock": {
                        "type": "object",
                        "properties": {
                            "kind": {"type": "string", "enum": ["text"]},
                            "text": {"type": "string"},
                        },
                        "required": ["kind", "text"],
                    },
                    "ImageBlock": {
                        "type": "object",
                        "properties": {
                            "kind": {"type": "string", "enum": ["image"]},
                            "url": {"type": "string"},
                            "mime_type": {"type": "string", "nullable": True},
                            "alt": {"type": "string", "nullable": True},
                            "width": {"type": "integer", "minimum": 1, "nullable": True},
                            "height": {"type": "integer", "minimum": 1, "nullable": True},
                        },
                        "required": ["kind", "url"],
                    },
                    "TableBlock": {
                        "type": "object",
                        "properties": {
                            "kind": {"type": "string", "enum": ["table"]},
                            "html": {"type": "string", "minLength": 1},
                        },
                        "required": ["kind", "html"],
                    },
                    "ContentBlock": {
                        "oneOf": [ref("TextBlock"), ref("ImageBlock"), ref("TableBlock")],
                        "discriminator": {
                            "propertyName": "kind",
                            "mapping": {
                                "text": "#/components/schemas/TextBlock",
                                "image": "#/components/schemas/ImageBlock",
                                "table": "#/components/schemas/TableBlock",
                            },
                        },
                    },
                    "SyllabusPoint": {
                        "type": "object",
                        "properties": {
                            "syllabus_id": {"type": "string"},
                            "point_code": {"type": "string"},
                            "label": {"type": "string", "nullable": True},
                        },
                        "required": ["syllabus_id", "point_code"],
                    },
                    "ChoiceOption": {
                        "type": "object",
                        "properties": {
                            "label": {"type": "string", "pattern": "^[A-Z]$"},
                            "content": array_of("ContentBlock"),
                        },
                        "required": ["label", "content"],
                    },
                    "QuestionAnswer": {
                        "type": "object",
                        "properties": {
                            "option_label": {"type": "string", "pattern": "^[A-Z]$", "nullable": True},
                            "summary": {"type": "string", "nullable": True},
                            "content": {"type": "array", "items": ref("ContentBlock"), "nullable": True},
                            "alternatives": {
                                "type": "array",
                                "items": {"type": "array", "items": ref("ContentBlock")},
                                "nullable": True,
                            },
                        },
                    },
                    "RubricCriterion": {
                        "type": "object",
                        "properties": {
                            "label": {"type": "string", "nullable": True},
                            "marks": {"type": "integer", "minimum": 0, "nullable": True},
                            "min_marks": {"type": "integer", "minimum": 0, "nullable": True},
                            "max_marks": {"type": "integer", "minimum": 0, "nullable": True},
                            "description": array_of("ContentBlock"),
                        },
                        "required": ["description"],
                    },
                    "QuestionRubric": {
                        "type": "object",
                        "properties": {
                            "criteria": array_of("RubricCriterion"),
                            "notes": {"type": "array", "items": ref("ContentBlock"), "nullable": True},
                        },
                        "required": ["criteria"],
                    },
                    "QuestionPart": {
                        "type": "object",
                        "properties": {
                            "label": {"type": "string", "pattern": "^[a-z]+$"},
                            "stimulus": {"type": "array", "items": ref("ContentBlock"), "nullable": True},
                            "content": array_of("ContentBlock"),
                            "marks": {"type": "integer", "minimum": 0, "nullable": True},
                            "is_independent": {"type": "boolean", "nullable": True},
                            "answer": {
                                "oneOf": [{"type": "string"}, ref("QuestionAnswer")],
                                "nullable": True,
                            },
                            "rubric": {"allOf": [ref("QuestionRubric")], "nullable": True},
                            "guidelines": {"type": "array", "items": ref("ContentBlock"), "nullable": True},
                        },
                        "required": ["label", "content"],
                    },
                    "QuestionWrite": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "string"},
                            "number": {"type": "integer", "minimum": 1},
                            "type": {
                                "type": "string",
                                "enum": ["multiple_choice", "short_answer", "long_answer"],
                                "default": "short_answer",
                            },
                            "marks": {"type": "integer", "minimum": 0, "default": 0},
                            "stimulus": {"type": "array", "items": ref("ContentBlock"), "nullable": True},
                            "content": {"type": "array", "items": ref("ContentBlock"), "nullable": True},
                            "parts": {"type": "array", "items": ref("QuestionPart"), "nullable": True},
                            "options": {"type": "array", "items": ref("ChoiceOption"), "nullable": True},
                            "answer": {
                                "oneOf": [{"type": "string"}, ref("QuestionAnswer")],
                                "nullable": True,
                            },
                            "rubric": {"allOf": [ref("QuestionRubric")], "nullable": True},
                            "guidelines": {"type": "array", "items": ref("ContentBlock"), "nullable": True},
                            "topics": {"type": "array", "items": {"type": "string"}, "nullable": True},
                            "outcomes": {"type": "array", "items": {"type": "string"}, "nullable": True},
                            "syllabus_points": {"type": "array", "items": ref("SyllabusPoint"), "nullable": True},
                            "difficulty": {
                                "type": "string",
                                "enum": ["easy", "medium", "hard"],
                                "nullable": True,
                            },
                            "created_at": {"type": "string", "format": "date-time"},
                            "updated_at": {"type": "string", "format": "date-time"},
                        },
                    },
                    "QuestionRead": {
                        "allOf": [
                            ref("QuestionWrite"),
                            {
                                "type": "object",
                                "properties": {
                                    "id": {"type": "string"},
                                    "paper_id": {"type": "string"},
                                    "author_id": {"type": "string"},
                                    "number": {"type": "integer"},
                                    "type": {
                                        "type": "string",
                                        "enum": ["multiple_choice", "short_answer", "long_answer"],
                                    },
                                    "marks": {"type": "integer"},
                                    "topics": {"type": "array", "items": {"type": "string"}},
                                    "outcomes": {"type": "array", "items": {"type": "string"}},
                                    "syllabus_points": array_of("SyllabusPoint"),
                                    "verified_changed": {"type": "boolean", "default": False},
                                    "created_at": {"type": "string", "format": "date-time"},
                                    "updated_at": {"type": "string", "format": "date-time"},
                                },
                                "required": [
                                    "id",
                                    "paper_id",
                                    "author_id",
                                    "number",
                                    "type",
                                    "marks",
                                    "topics",
                                    "outcomes",
                                    "syllabus_points",
                                    "created_at",
                                    "updated_at",
                                ],
                            },
                        ]
                    },
                    "PaperWrite": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "string"},
                            "title": {"type": "string", "default": "Untitled"},
                            "subject": {"type": "string"},
                            "syllabus_id": {"type": "string", "nullable": True},
                            "year": {"type": "integer", "minimum": 2000, "nullable": True},
                            "source": {
                                "type": "string",
                                "enum": ["hsc", "trial", "internal", "practice", "custom"],
                                "nullable": True,
                            },
                            "school": {"type": "string", "nullable": True},
                            "course_level": {
                                "type": "string",
                                "enum": ["standard", "advanced", "extension_1", "extension_2"],
                                "nullable": True,
                            },
                            "topics": {"type": "array", "items": {"type": "string"}, "nullable": True},
                            "outcomes": {"type": "array", "items": {"type": "string"}, "nullable": True},
                            "visibility": {
                                "type": "string",
                                "enum": ["private", "public"],
                                "default": "private",
                            },
                            "question_count": {"type": "integer", "minimum": 0, "default": 0},
                            "total_marks": {"type": "integer", "minimum": 0, "default": 0},
                            "duration_minutes": {"type": "integer", "minimum": 0, "nullable": True},
                            "questions": {"type": "array", "items": ref("QuestionWrite")},
                        },
                    },
                    "PaperMeta": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "string"},
                            "title": {"type": "string"},
                            "author_id": {"type": "string"},
                            "subject": {"type": "string"},
                            "syllabus_id": {"type": "string", "nullable": True},
                            "year": {"type": "integer", "nullable": True},
                            "source": {
                                "type": "string",
                                "enum": ["hsc", "trial", "internal", "practice", "custom"],
                                "nullable": True,
                            },
                            "school": {"type": "string", "nullable": True},
                            "course_level": {
                                "type": "string",
                                "enum": ["standard", "advanced", "extension_1", "extension_2"],
                                "nullable": True,
                            },
                            "topics": {"type": "array", "items": {"type": "string"}},
                            "outcomes": {"type": "array", "items": {"type": "string"}},
                            "visibility": {"type": "string", "enum": ["private", "public"]},
                            "question_count": {"type": "integer"},
                            "total_marks": {"type": "integer"},
                            "duration_minutes": {"type": "integer", "nullable": True},
                            "verified": {"type": "boolean"},
                            "verified_source_name": {"type": "string", "nullable": True},
                            "verified_source_url": {"type": "string", "nullable": True},
                            "verified_at": {"type": "string", "format": "date-time", "nullable": True},
                            "verified_by": {"type": "string", "nullable": True},
                            "created_at": {"type": "string", "format": "date-time"},
                            "updated_at": {"type": "string", "format": "date-time"},
                            "remixed": {"type": "string", "nullable": True},
                        },
                        "required": [
                            "id",
                            "title",
                            "author_id",
                            "subject",
                            "topics",
                            "outcomes",
                            "visibility",
                            "question_count",
                            "total_marks",
                            "verified",
                            "created_at",
                            "updated_at",
                        ],
                    },
                    "Paper": {
                        "allOf": [
                            ref("PaperMeta"),
                            {
                                "type": "object",
                                "properties": {
                                    "syllabus_id": {"type": "string", "nullable": True},
                                    "questions": {"type": "array", "items": ref("QuestionRead")},
                                },
                                "required": ["questions"],
                            },
                        ]
                    },
                    "PaperList": {
                        "type": "object",
                        "properties": {
                            "papers": {"type": "array", "items": ref("PaperMeta")},
                            "total": {"type": "integer"},
                            "page": {"type": "integer"},
                            "per_page": {"type": "integer"},
                        },
                        "required": ["papers", "total", "page", "per_page"],
                    },
                    "AssetUploadResult": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "string"},
                            "paper_id": {"type": "string"},
                            "mime_type": {"type": "string"},
                        },
                        "required": ["id", "paper_id", "mime_type"],
                    },
                    "QuestionRemixRequest": {
                        "type": "object",
                        "properties": {
                            "target_paper_id": {
                                "type": "string",
                                "description": "Authenticated user's paper that will receive the cloned question.",
                            },
                        },
                        "required": ["target_paper_id"],
                    },
                    "AdminStatus": {
                        "type": "object",
                        "properties": {
                            "admin": {"type": "boolean"},
                            "admin_available": {"type": "boolean"},
                        },
                        "required": ["admin", "admin_available"],
                    },
                    "AdminTakedownResult": {
                        "type": "object",
                        "properties": {
                            "message": {"type": "string"},
                            "taken_down": {"type": "array", "items": {"type": "string"}},
                            "restored": {"type": "array", "items": {"type": "string"}},
                        },
                        "required": ["message"],
                    },
                    "PaperVerificationUpdate": {
                        "type": "object",
                        "properties": {
                            "verified": {"type": "boolean", "default": False},
                            "source_name": {"type": "string", "maxLength": 160},
                            "source_url": {"type": "string", "format": "uri", "maxLength": 500},
                        },
                    },
                    "PaperStar": {
                        "type": "object",
                        "properties": {
                            "paper": ref("PaperMeta"),
                            "starred_at": {"type": "string", "format": "date-time", "nullable": True},
                        },
                        "required": ["paper", "starred_at"],
                    },
                    "StarStatus": {
                        "type": "object",
                        "properties": {
                            "starred": {"type": "boolean"},
                            "starred_at": {"type": "string", "format": "date-time", "nullable": True},
                        },
                        "required": ["starred"],
                    },
                    "PaperReport": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "integer"},
                            "paper_id": {"type": "string"},
                            "reporter_id": {"type": "string"},
                            "reason": {
                                "type": "string",
                                "enum": [
                                    "false_information",
                                    "copyright",
                                    "inappropriate",
                                    "broken_content",
                                    "spam",
                                    "other",
                                ],
                            },
                            "details": {"type": "string", "nullable": True},
                            "status": {
                                "type": "string",
                                "enum": ["open", "reviewing", "resolved", "dismissed"],
                            },
                            "created_at": {"type": "string", "format": "date-time", "nullable": True},
                            "updated_at": {"type": "string", "format": "date-time", "nullable": True},
                            "paper": {"allOf": [ref("PaperMeta")], "nullable": True},
                        },
                        "required": [
                            "id",
                            "paper_id",
                            "reporter_id",
                            "reason",
                            "status",
                            "created_at",
                            "updated_at",
                        ],
                    },
                    "PaperReportCreate": {
                        "type": "object",
                        "properties": {
                            "reason": {
                                "type": "string",
                                "enum": [
                                    "false_information",
                                    "copyright",
                                    "inappropriate",
                                    "broken_content",
                                    "spam",
                                    "other",
                                ],
                            },
                            "details": {"type": "string", "maxLength": 2000},
                        },
                        "required": ["reason"],
                    },
                    "PaperReportUpdate": {
                        "type": "object",
                        "properties": {
                            "status": {
                                "type": "string",
                                "enum": ["open", "reviewing", "resolved", "dismissed"],
                            }
                        },
                        "required": ["status"],
                    },
                    "PaperReportList": {
                        "type": "object",
                        "properties": {
                            "reports": {"type": "array", "items": ref("PaperReport")},
                            "total": {"type": "integer"},
                            "page": {"type": "integer"},
                            "per_page": {"type": "integer"},
                        },
                        "required": ["reports", "total", "page", "per_page"],
                    },
                    "PresencePaper": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "string"},
                            "title": {"type": "string"},
                            "subject": {"type": "string"},
                            "visibility": {"type": "string", "enum": ["public"]},
                        },
                        "required": ["id", "title", "subject", "visibility"],
                    },
                    "Presence": {
                        "type": "object",
                        "properties": {
                            "online": {"type": "boolean"},
                            "session_started_at": {"type": "string", "format": "date-time", "nullable": True},
                            "last_seen_at": {"type": "string", "format": "date-time", "nullable": True},
                            "seconds_on_site": {"type": "integer"},
                            "active_paper": {"allOf": [ref("PresencePaper")], "nullable": True},
                            "active_seconds": {"type": "integer"},
                        },
                        "required": [
                            "online",
                            "session_started_at",
                            "last_seen_at",
                            "seconds_on_site",
                            "active_paper",
                            "active_seconds",
                        ],
                    },
                    "FriendUser": {
                        "type": "object",
                        "properties": {
                            "user_id": {"type": "string"},
                            "username": {"type": "string"},
                            "avatar_url": {"type": "string", "nullable": True},
                        },
                        "required": ["user_id", "username"],
                    },
                    "FriendRequest": {
                        "type": "object",
                        "additionalProperties": True,
                        "properties": {
                            "id": {"type": "integer"},
                            "status": {"type": "string"},
                            "created_at": {"type": "string", "format": "date-time", "nullable": True},
                            "updated_at": {"type": "string", "format": "date-time", "nullable": True},
                            "user": {"allOf": [ref("FriendUser")], "nullable": True},
                            "from_user": {"allOf": [ref("FriendUser")], "nullable": True},
                            "to_user": {"allOf": [ref("FriendUser")], "nullable": True},
                        },
                    },
                    "FriendRequests": {
                        "type": "object",
                        "properties": {"requests": {"type": "array", "items": ref("FriendRequest")}},
                        "required": ["requests"],
                    },
                    "Friends": {
                        "type": "object",
                        "properties": {"friends": {"type": "array", "items": ref("FriendUser")}},
                        "required": ["friends"],
                    },
                    "AttemptPaperMeta": {
                        "type": "object",
                        "nullable": True,
                        "properties": {
                            "title": {"type": "string"},
                            "subject": {"type": "string"},
                            "visibility": {"type": "string"},
                            "question_count": {"type": "integer"},
                            "total_marks": {"type": "integer"},
                            "duration_minutes": {"type": "integer", "nullable": True},
                            "available": {"type": "boolean"},
                        },
                    },
                    "QuestionAttempt": {
                        "type": "object",
                        "properties": {
                            "question_id": {"type": "string"},
                            "part_path": {"type": "string", "nullable": True},
                            "seconds": {"type": "integer"},
                            "revealed_answer": {"type": "boolean"},
                            "reveal_count": {"type": "integer"},
                            "views": {"type": "integer"},
                        },
                        "required": [
                            "question_id",
                            "part_path",
                            "seconds",
                            "revealed_answer",
                            "reveal_count",
                            "views",
                        ],
                    },
                    "Attempt": {
                        "type": "object",
                        "properties": {
                            "id": {"type": "string"},
                            "paper_id": {"type": "string"},
                            "paper": ref("AttemptPaperMeta"),
                            "started_at": {"type": "string", "format": "date-time", "nullable": True},
                            "last_active_at": {"type": "string", "format": "date-time", "nullable": True},
                            "completed_at": {"type": "string", "format": "date-time", "nullable": True},
                            "elapsed_seconds": {"type": "integer"},
                            "completed": {"type": "boolean"},
                            "questions_seen": {"type": "integer"},
                            "questions_answered": {"type": "integer"},
                            "reveal_count": {"type": "integer"},
                            "max_slide": {"type": "integer"},
                        },
                        "required": [
                            "id",
                            "paper_id",
                            "paper",
                            "started_at",
                            "last_active_at",
                            "completed_at",
                            "elapsed_seconds",
                            "completed",
                            "questions_seen",
                            "questions_answered",
                            "reveal_count",
                            "max_slide",
                        ],
                    },
                    "AttemptDetail": {
                        "allOf": [
                            ref("Attempt"),
                            {
                                "type": "object",
                                "properties": {
                                    "question_times": {"type": "array", "items": ref("QuestionAttempt")}
                                },
                                "required": ["question_times"],
                            },
                        ]
                    },
                    "AttemptList": {
                        "type": "object",
                        "properties": {
                            "attempts": {"type": "array", "items": ref("Attempt")},
                            "total": {"type": "integer"},
                            "page": {"type": "integer"},
                            "per_page": {"type": "integer"},
                        },
                        "required": ["attempts", "total", "page", "per_page"],
                    },
                    "StudentStats": {
                        "type": "object",
                        "additionalProperties": True,
                        "properties": {
                            "attempts_count": {"type": "integer"},
                            "papers_attempted": {"type": "integer"},
                            "papers_completed": {"type": "integer"},
                            "questions_answered": {"type": "integer"},
                            "total_study_seconds": {"type": "integer"},
                            "reveal_count": {"type": "integer"},
                            "current_streak": {"type": "integer"},
                            "longest_streak": {"type": "integer"},
                            "last_active_at": {"type": "string", "format": "date-time", "nullable": True},
                        },
                    },
                    "StudentStatsUser": {
                        "allOf": [
                            ref("StudentStats"),
                            {
                                "type": "object",
                                "properties": {
                                    "user_id": {"type": "string"},
                                    "username": {"type": "string"},
                                    "avatar_url": {"type": "string", "nullable": True},
                                    "joined_at": {"type": "string", "format": "date-time", "nullable": True},
                                },
                                "required": ["user_id", "username"],
                            },
                        ]
                    },
                    "MyStats": {
                        "allOf": [
                            ref("StudentStatsUser"),
                            {
                                "type": "object",
                                "properties": {"recent_attempts": {"type": "array", "items": ref("Attempt")}},
                                "required": ["recent_attempts"],
                            },
                        ]
                    },
                    "LeaderboardEntry": {
                        "allOf": [
                            ref("StudentStatsUser"),
                            {
                                "type": "object",
                                "properties": {"rank": {"type": "integer"}},
                                "required": ["rank"],
                            },
                        ]
                    },
                    "UserProfile": {
                        "type": "object",
                        "properties": {
                            "user": {
                                "type": "object",
                                "properties": {
                                    "user_id": {"type": "string"},
                                    "username": {"type": "string"},
                                    "avatar_url": {"type": "string", "nullable": True},
                                    "created_at": {"type": "string", "format": "date-time", "nullable": True},
                                },
                                "required": ["user_id", "username", "avatar_url", "created_at"],
                            },
                            "stats": ref("StudentStats"),
                            "presence": {"allOf": [ref("Presence")], "nullable": True},
                            "public_papers": {"type": "array", "items": ref("PaperMeta")},
                        },
                        "required": ["user", "stats", "presence", "public_papers"],
                    },
                },
            },
            "paths": {
                "/ping": {
                    "get": {
                        "tags": ["System"],
                        "summary": "Health check",
                        "responses": {
                            "200": response("Backend is running", {"type": "string"}),
                        },
                    }
                },
                "/api/whoami": {
                    "get": {
                        "tags": ["Authentication"],
                        "summary": "Get the authenticated user",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                        "responses": {
                            "200": response("Authenticated user details", ref("WhoAmI")),
                            "401": error_response("Missing or invalid Supabase token"),
                            "404": error_response("User not found"),
                            "500": error_response("Failed to fetch user"),
                        },
                    }
                },
                "/api/verify_2fa": {
                    "post": {
                        "tags": ["Authentication"],
                        "summary": "Verify a two-factor authentication code",
                        "description": "Legacy endpoint. Login and 2FA sessions are handled by Supabase Auth.",
                        "responses": {
                            "410": message_response("2FA login is handled by Supabase Auth"),
                        },
                    }
                },
                "/api/whotf": {
                    "get": {
                        "tags": ["Account"],
                        "summary": "Get a public username by user id",
                        "parameters": [
                            {
                                "name": "user_id",
                                "in": "query",
                                "required": True,
                                "schema": {"type": "string"},
                            }
                        ],
                        "responses": {
                            "200": response(
                                "User summary",
                                {
                                    "type": "object",
                                    "properties": {
                                        "user_id": {"type": "string"},
                                        "username": {"type": "string"},
                                    },
                                    "required": ["user_id", "username"],
                                },
                            ),
                            "400": error_response("Missing user_id"),
                            "404": error_response("User not found"),
                        },
                    }
                },
                "/api/account/username": {
                    "put": {
                        "tags": ["Account"],
                        "summary": "Update username",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                        "requestBody": form_request_body(
                            {"username": {"type": "string"}},
                            ["username"],
                        ),
                        "responses": {
                            "200": response(
                                "Username updated",
                                {
                                    "type": "object",
                                    "properties": {
                                        "message": {"type": "string"},
                                        "username": {"type": "string"},
                                    },
                                    "required": ["message", "username"],
                                },
                            ),
                            "400": error_response("Invalid or duplicate username"),
                            "401": error_response("Missing or invalid Supabase token"),
                            "404": error_response("User not found"),
                            "500": error_response("Failed to update username"),
                        },
                    }
                },
                "/api/account/password": {
                    "put": {
                        "tags": ["Account"],
                        "summary": "Update password",
                        "description": "Password changes are handled by Supabase Auth, so this legacy local endpoint is disabled.",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                        "responses": {
                            "410": message_response("Password changes are handled by Supabase Auth"),
                        },
                    }
                },
                "/api/account": {
                    "delete": {
                        "tags": ["Account"],
                        "summary": "Delete account",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                        "responses": {
                            "200": message_response("Account deleted"),
                            "401": error_response("Missing or invalid Supabase token"),
                            "404": error_response("User not found"),
                            "500": error_response("Failed to delete account"),
                        },
                    }
                },
                "/api/account/data": {
                    "delete": {
                        "tags": ["Account"],
                        "summary": "Reset account data",
                        "description": "Deletes the authenticated user's app data while preserving the Supabase Auth user and local users row.",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                        "responses": {
                            "200": message_response("Account data reset"),
                            "401": error_response("Missing or invalid Supabase token"),
                            "404": error_response("User not found"),
                            "500": error_response("Failed to reset account data"),
                        },
                    }
                },
                "/api/account/avatar": {
                    "put": {
                        "tags": ["Account"],
                        "summary": "Upload or replace avatar",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                        "requestBody": multipart_request_body(
                            {"file": {"type": "string", "format": "binary"}},
                            ["file"],
                        ),
                        "responses": {
                            "200": response("Avatar URL updated", ref("AvatarUpdateResult")),
                            "400": error_response("Missing file, unsupported image type, or invalid image"),
                            "401": error_response("Missing or invalid Supabase token"),
                            "500": error_response("Failed to update avatar"),
                        },
                    },
                    "delete": {
                        "tags": ["Account"],
                        "summary": "Remove avatar",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                        "responses": {
                            "200": message_response("Avatar removed"),
                            "401": error_response("Missing or invalid Supabase token"),
                            "404": error_response("User not found"),
                            "500": error_response("Failed to remove avatar"),
                        },
                    },
                },
                "/api/account/enable_2fa": {
                    "post": {
                        "tags": ["Account"],
                        "summary": "Enable two-factor authentication",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                        "responses": {
                            "200": response("2FA setup details generated", ref("TwoFactorSetup")),
                            "400": error_response("2FA is already enabled"),
                            "401": error_response("Missing or invalid Supabase token"),
                            "404": error_response("User not found"),
                            "500": error_response("Failed to enable 2FA"),
                        },
                    }
                },
                "/api/account/disable_2fa": {
                    "post": {
                        "tags": ["Account"],
                        "summary": "Disable two-factor authentication",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                        "requestBody": form_request_body(
                            {"totp_code": {"type": "string"}},
                            ["totp_code"],
                        ),
                        "responses": {
                            "200": message_response("2FA disabled"),
                            "400": error_response("Missing 2FA code or 2FA disabled"),
                            "401": error_response("Invalid 2FA code or Supabase token"),
                            "404": error_response("User not found"),
                            "500": error_response("Failed to disable 2FA"),
                        },
                    }
                },
                "/api/papers/{paper_id}/assets": {
                    "post": {
                        "tags": ["Assets"],
                        "summary": "Upload a paper image asset",
                        "description": "Uploads an image asset for an author-owned paper. Removed papers cannot receive new assets.",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                        "parameters": [paper_id_parameter()],
                        "requestBody": multipart_request_body(
                            {
                                "file": {"type": "string", "format": "binary"},
                                "asset_id": {
                                    "type": "string",
                                    "pattern": "^[A-Za-z0-9_-]{8,128}$",
                                    "description": "Optional client-generated asset id. A UUID is generated if omitted.",
                                },
                            },
                            ["file"],
                        ),
                        "responses": {
                            "201": response("Asset uploaded", ref("AssetUploadResult")),
                            "400": error_response("Missing file, invalid asset id, or unsupported file type"),
                            "401": error_response("Missing or invalid Supabase token"),
                            "403": error_response("Authenticated user is not the paper author"),
                            "404": error_response("Paper not found"),
                            "409": error_response("Asset id already belongs to another paper"),
                            "410": error_response("Paper has been removed"),
                        },
                    }
                },
                "/api/assets/{asset_id}": {
                    "get": {
                        "tags": ["Assets"],
                        "summary": "Get an uploaded asset",
                        "description": "Returns an asset only if the caller can view the parent paper. Public paper assets can be read without login; private paper assets require the author or an admin.",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}, {}],
                        "parameters": [asset_id_parameter()],
                        "responses": {
                            "200": binary_response("Asset bytes", "image/*"),
                            "404": error_response("Asset not found or not visible"),
                        },
                    }
                },
                "/api/papers/search": {
                    "get": {
                        "tags": ["Papers"],
                        "summary": "Search public papers",
                        "parameters": pagination_parameters(),
                        "responses": {
                            "200": response("Public paper search results", ref("PaperList")),
                            "500": error_response("Failed to search papers"),
                        },
                    }
                },
                "/api/papers": {
                    "get": {
                        "tags": ["Papers"],
                        "summary": "List authenticated user's papers",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                        "parameters": pagination_parameters(),
                        "responses": {
                            "200": response("User paper results", ref("PaperList")),
                            "401": error_response("Missing or invalid Supabase token"),
                            "500": error_response("Failed to list papers"),
                        },
                    },
                    "post": {
                        "tags": ["Papers"],
                        "summary": "Create a paper",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                        "requestBody": json_request_body(ref("PaperWrite")),
                        "responses": {
                            "201": response("Paper created", ref("Paper")),
                            "400": error_response("No data provided"),
                            "401": error_response("Missing or invalid Supabase token"),
                            "500": error_response("Failed to create paper"),
                        },
                    },
                },
                "/api/papers/{paper_id}": {
                    "get": {
                        "tags": ["Papers"],
                        "summary": "Get a paper",
                        "description": "Public papers can be read without login. Private papers require the author's Supabase bearer token.",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}, {}],
                        "parameters": [paper_id_parameter()],
                        "responses": {
                            "200": response("Paper details", ref("Paper")),
                            "404": error_response("Paper not found or private"),
                            "500": error_response("Failed to get paper"),
                        },
                    },
                    "put": {
                        "tags": ["Papers"],
                        "summary": "Update a paper",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                        "parameters": [paper_id_parameter()],
                        "requestBody": json_request_body(ref("PaperWrite")),
                        "responses": {
                            "200": response("Paper updated", ref("Paper")),
                            "400": error_response("No data provided"),
                            "401": error_response("Missing or invalid Supabase token"),
                            "403": error_response("Authenticated user is not the author"),
                            "404": error_response("Paper not found"),
                            "500": error_response("Failed to update paper"),
                        },
                    },
                    "delete": {
                        "tags": ["Papers"],
                        "summary": "Delete a paper",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                        "parameters": [paper_id_parameter()],
                        "responses": {
                            "200": message_response("Paper deleted"),
                            "401": error_response("Missing or invalid Supabase token"),
                            "403": error_response("Authenticated user is not the author"),
                            "404": error_response("Paper not found"),
                            "500": error_response("Failed to delete paper"),
                        },
                    },
                },
                "/api/papers/{paper_id}/publish": {
                    "post": {
                        "tags": ["Papers"],
                        "summary": "Publish a paper",
                        "description": "Marks an existing author-owned paper as public. If the paper does not exist, the JSON body is used to create it before publishing.",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                        "parameters": [paper_id_parameter()],
                        "requestBody": json_request_body(ref("PaperWrite"), required=False),
                        "responses": {
                            "200": response("Paper published", ref("PaperMeta")),
                            "400": error_response("Paper does not exist and no body was provided"),
                            "401": error_response("Missing or invalid Supabase token"),
                            "403": error_response("Authenticated user is not the author"),
                            "409": error_response("Paper is already public"),
                            "500": error_response("Failed to publish paper"),
                        },
                    },
                    "delete": {
                        "tags": ["Papers"],
                        "summary": "Unpublish a paper",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                        "parameters": [paper_id_parameter()],
                        "responses": {
                            "200": response("Paper unpublished", ref("PaperMeta")),
                            "401": error_response("Missing or invalid Supabase token"),
                            "403": error_response("Authenticated user is not the author"),
                            "404": error_response("Paper not found"),
                            "409": error_response("Paper is already private"),
                            "500": error_response("Failed to unpublish paper"),
                        },
                    },
                },
                "/api/papers/{paper_id}/remix": {
                    "post": {
                        "tags": ["Papers"],
                        "summary": "Remix a public paper",
                        "description": "Copies a public paper and its questions into the authenticated user's private library.",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                        "parameters": [paper_id_parameter()],
                        "responses": {
                            "201": response("Private remix created", ref("Paper")),
                            "401": error_response("Missing or invalid Supabase token"),
                            "403": error_response("Cannot remix a private paper"),
                            "404": error_response("Paper not found"),
                            "500": error_response("Failed to remix paper"),
                        },
                    }
                },
                "/api/papers/{paper_id}/questions/{question_id}/remix": {
                    "post": {
                        "tags": ["Papers"],
                        "summary": "Remix a question into one of the user's papers",
                        "description": "Copies one question from a public source paper into an authenticated user's target paper.",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                        "parameters": [paper_id_parameter(), question_id_parameter()],
                        "requestBody": json_request_body(ref("QuestionRemixRequest")),
                        "responses": {
                            "201": response("Target paper with cloned question", ref("Paper")),
                            "400": error_response("target_paper_id is required"),
                            "401": error_response("Missing or invalid Supabase token"),
                            "403": error_response("Source paper is private or target paper is not owned by the caller"),
                            "404": error_response("Source paper, source question, or target paper not found"),
                            "410": error_response("Target paper has been removed"),
                        },
                    }
                },
                "/api/admin/verify": {
                    "post": {
                        "tags": ["Admin"],
                        "summary": "Activate admin mode",
                        "description": "Activates admin mode for authenticated users with an admin row in public.user_roles.",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                        "responses": {
                            "200": response("Admin mode activated", ref("AdminStatus")),
                            "401": error_response("Missing or invalid Supabase token"),
                            "403": error_response("Admin role required"),
                        },
                    }
                },
                "/api/admin/status": {
                    "get": {
                        "tags": ["Admin"],
                        "summary": "Get admin status",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                        "responses": {
                            "200": response("Current admin status", ref("AdminStatus")),
                            "401": error_response("Missing or invalid Supabase token"),
                        },
                    }
                },
                "/api/admin/papers/{paper_id}/verification": {
                    "patch": {
                        "tags": ["Admin"],
                        "summary": "Update paper verification",
                        "description": "Sets or clears the public verification checkmark and optional source metadata for a paper.",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                        "parameters": [paper_id_parameter()],
                        "requestBody": json_request_body(ref("PaperVerificationUpdate")),
                        "responses": {
                            "200": response("Updated paper metadata", ref("PaperMeta")),
                            "400": error_response("Invalid verification source metadata"),
                            "401": error_response("Missing or invalid Supabase token"),
                            "403": error_response("Authenticated user is not an active admin"),
                            "404": error_response("Paper not found"),
                        },
                    }
                },
                "/api/admin/takedowns": {
                    "get": {
                        "tags": ["Admin"],
                        "summary": "List removed papers",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                        "parameters": [
                            {"name": "q", "in": "query", "schema": {"type": "string"}},
                            {"name": "page", "in": "query", "schema": {"type": "integer", "minimum": 1, "default": 1}},
                            {"name": "per_page", "in": "query", "schema": {"type": "integer", "minimum": 1, "maximum": 100, "default": 20}},
                        ],
                        "responses": {
                            "200": response("Removed paper results", ref("PaperList")),
                            "401": error_response("Missing or invalid Supabase token"),
                            "403": error_response("Authenticated user is not an active admin"),
                        },
                    }
                },
                "/api/admin/takedown/{paper_id}": {
                    "post": {
                        "tags": ["Admin"],
                        "summary": "Take down a paper and its remixes",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                        "parameters": [paper_id_parameter()],
                        "responses": {
                            "200": response("Papers taken down", ref("AdminTakedownResult")),
                            "401": error_response("Missing or invalid Supabase token"),
                            "403": error_response("Authenticated user is not an active admin"),
                            "404": error_response("Paper not found"),
                        },
                    },
                    "delete": {
                        "tags": ["Admin"],
                        "summary": "Restore a taken-down paper and its remixes",
                        "description": "Restores remembered previous visibility where available; otherwise restores papers to private.",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                        "parameters": [paper_id_parameter()],
                        "responses": {
                            "200": response("Papers restored", ref("AdminTakedownResult")),
                            "401": error_response("Missing or invalid Supabase token"),
                            "403": error_response("Authenticated user is not an active admin"),
                            "404": error_response("Paper not found"),
                            "409": error_response("Paper is not taken down"),
                        },
                    },
                },
                "/api/stars": {
                    "get": {
                        "tags": ["Stars"],
                        "summary": "List starred papers",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                        "responses": {
                            "200": response(
                                "Starred papers",
                                {
                                    "type": "object",
                                    "properties": {"stars": {"type": "array", "items": ref("PaperStar")}},
                                    "required": ["stars"],
                                },
                            ),
                            "401": error_response("Missing or invalid Supabase token"),
                        },
                    }
                },
                "/api/papers/{paper_id}/star": {
                    "get": {
                        "tags": ["Stars"],
                        "summary": "Get paper star status",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}, {}],
                        "parameters": [paper_id_parameter()],
                        "responses": {"200": response("Star status", ref("StarStatus"))},
                    },
                    "post": {
                        "tags": ["Stars"],
                        "summary": "Star a paper",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                        "parameters": [paper_id_parameter()],
                        "responses": {
                            "200": response("Paper starred", ref("StarStatus")),
                            "401": error_response("Missing or invalid Supabase token"),
                            "404": error_response("Paper not found"),
                        },
                    },
                    "delete": {
                        "tags": ["Stars"],
                        "summary": "Unstar a paper",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                        "parameters": [paper_id_parameter()],
                        "responses": {
                            "200": response("Paper unstarred", ref("StarStatus")),
                            "401": error_response("Missing or invalid Supabase token"),
                        },
                    },
                },
                "/api/papers/{paper_id}/reports": {
                    "post": {
                        "tags": ["Reports"],
                        "summary": "Report a paper",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                        "parameters": [paper_id_parameter()],
                        "requestBody": json_request_body(ref("PaperReportCreate")),
                        "responses": {
                            "201": response("Paper report created", ref("PaperReport")),
                            "400": error_response("Invalid report reason or details"),
                            "401": error_response("Missing or invalid Supabase token"),
                            "404": error_response("Paper not found"),
                        },
                    }
                },
                "/api/admin/reports": {
                    "get": {
                        "tags": ["Reports"],
                        "summary": "List paper reports",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                        "parameters": [
                            {
                                "name": "status",
                                "in": "query",
                                "schema": {
                                    "type": "string",
                                    "enum": ["open", "reviewing", "resolved", "dismissed", "all"],
                                    "default": "open",
                                },
                            },
                            {"name": "paper_id", "in": "query", "schema": {"type": "string"}},
                            {"name": "page", "in": "query", "schema": {"type": "integer", "minimum": 1, "default": 1}},
                            {"name": "per_page", "in": "query", "schema": {"type": "integer", "minimum": 1, "maximum": 100, "default": 20}},
                        ],
                        "responses": {
                            "200": response("Paper reports", ref("PaperReportList")),
                            "400": error_response("Invalid report status"),
                            "401": error_response("Missing or invalid Supabase token"),
                            "403": error_response("Authenticated user is not an active admin"),
                        },
                    }
                },
                "/api/admin/reports/{report_id}": {
                    "patch": {
                        "tags": ["Reports"],
                        "summary": "Update report status",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                        "parameters": [report_id_parameter()],
                        "requestBody": json_request_body(ref("PaperReportUpdate")),
                        "responses": {
                            "200": response("Updated paper report", ref("PaperReport")),
                            "400": error_response("Invalid report status"),
                            "401": error_response("Missing or invalid Supabase token"),
                            "403": error_response("Authenticated user is not an active admin"),
                            "404": error_response("Report not found"),
                        },
                    }
                },
                "/api/presence": {
                    "post": {
                        "tags": ["Social"],
                        "summary": "Record presence heartbeat",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                        "requestBody": json_request_body(
                            {
                                "type": "object",
                                "properties": {
                                    "paper_id": {
                                        "type": "string",
                                        "nullable": True,
                                        "description": "Omit to keep the current active paper, set to null or empty to clear it.",
                                    }
                                },
                            },
                            required=False,
                        ),
                        "responses": {
                            "200": response("Presence state", ref("Presence")),
                            "401": error_response("Missing or invalid Supabase token"),
                            "404": error_response("Paper not found"),
                        },
                    }
                },
                "/api/presence/active-paper": {
                    "delete": {
                        "tags": ["Social"],
                        "summary": "Clear active paper presence",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                        "responses": {
                            "200": response("Presence state", ref("Presence")),
                            "401": error_response("Missing or invalid Supabase token"),
                        },
                    }
                },
                "/api/friends/requests": {
                    "post": {
                        "tags": ["Social"],
                        "summary": "Send a friend request",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                        "requestBody": json_request_body(
                            {
                                "type": "object",
                                "properties": {"username": {"type": "string"}},
                                "required": ["username"],
                            }
                        ),
                        "responses": {
                            "201": message_response("Friend request sent"),
                            "400": error_response("Invalid request"),
                            "401": error_response("Missing or invalid Supabase token"),
                            "404": error_response("No user with that username"),
                        },
                    }
                },
                "/api/friends/requests/incoming": {
                    "get": {
                        "tags": ["Social"],
                        "summary": "List incoming friend requests",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                        "responses": {
                            "200": response("Incoming friend requests", ref("FriendRequests")),
                            "401": error_response("Missing or invalid Supabase token"),
                        },
                    }
                },
                "/api/friends/requests/outgoing": {
                    "get": {
                        "tags": ["Social"],
                        "summary": "List outgoing friend requests",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                        "responses": {
                            "200": response("Outgoing friend requests", ref("FriendRequests")),
                            "401": error_response("Missing or invalid Supabase token"),
                        },
                    }
                },
                "/api/friends/requests/{friendship_id}/accept": {
                    "post": {
                        "tags": ["Social"],
                        "summary": "Accept a friend request",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                        "parameters": [friendship_id_parameter()],
                        "responses": {
                            "200": message_response("Friend request accepted"),
                            "400": error_response("Invalid friend request action"),
                            "401": error_response("Missing or invalid Supabase token"),
                        },
                    }
                },
                "/api/friends/requests/{friendship_id}/decline": {
                    "post": {
                        "tags": ["Social"],
                        "summary": "Decline a friend request",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                        "parameters": [friendship_id_parameter()],
                        "responses": {
                            "200": message_response("Friend request declined"),
                            "400": error_response("Invalid friend request action"),
                            "401": error_response("Missing or invalid Supabase token"),
                        },
                    }
                },
                "/api/friends/requests/{friendship_id}": {
                    "delete": {
                        "tags": ["Social"],
                        "summary": "Cancel an outgoing friend request",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                        "parameters": [friendship_id_parameter()],
                        "responses": {
                            "200": message_response("Friend request cancelled"),
                            "400": error_response("Invalid friend request action"),
                            "401": error_response("Missing or invalid Supabase token"),
                        },
                    }
                },
                "/api/friends": {
                    "get": {
                        "tags": ["Social"],
                        "summary": "List friends",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                        "responses": {
                            "200": response("Friends", ref("Friends")),
                            "401": error_response("Missing or invalid Supabase token"),
                        },
                    }
                },
                "/api/friends/{other_id}": {
                    "delete": {
                        "tags": ["Social"],
                        "summary": "Remove a friend",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                        "parameters": [user_id_path_parameter("other_id")],
                        "responses": {
                            "200": message_response("Friend removed"),
                            "400": error_response("Invalid friend removal"),
                            "401": error_response("Missing or invalid Supabase token"),
                        },
                    }
                },
                "/api/users/{profile_ref}/profile": {
                    "get": {
                        "tags": ["Social"],
                        "summary": "Get a public user profile by user id or username",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}, {}],
                        "parameters": [user_id_path_parameter("profile_ref")],
                        "responses": {
                            "200": response("User profile", ref("UserProfile")),
                            "404": error_response("User not found"),
                        },
                    }
                },
                "/api/leaderboard": {
                    "get": {
                        "tags": ["Social"],
                        "summary": "Get leaderboard",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}, {}],
                        "parameters": [
                            {
                                "name": "scope",
                                "in": "query",
                                "schema": {"type": "string", "enum": ["global", "friends"]},
                            }
                        ],
                        "responses": {
                            "200": response(
                                "Leaderboard entries",
                                {
                                    "type": "object",
                                    "properties": {"entries": {"type": "array", "items": ref("LeaderboardEntry")}},
                                    "required": ["entries"],
                                },
                            ),
                            "401": error_response("Sign in to view the friends leaderboard"),
                        },
                    }
                },
                "/api/attempts": {
                    "post": {
                        "tags": ["Progress"],
                        "summary": "Start a paper attempt",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                        "requestBody": json_request_body(
                            {
                                "type": "object",
                                "properties": {"paper_id": {"type": "string"}},
                                "required": ["paper_id"],
                            }
                        ),
                        "responses": {
                            "201": response("Attempt created", ref("Attempt")),
                            "400": error_response("paper_id is required"),
                            "401": error_response("Missing or invalid Supabase token"),
                        },
                    },
                    "get": {
                        "tags": ["Progress"],
                        "summary": "List paper attempts",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                        "parameters": [
                            {"name": "paper_id", "in": "query", "schema": {"type": "string"}},
                            {"name": "completed", "in": "query", "schema": {"type": "boolean"}},
                            {"name": "page", "in": "query", "schema": {"type": "integer", "minimum": 1, "default": 1}},
                            {"name": "per_page", "in": "query", "schema": {"type": "integer", "minimum": 1, "maximum": 100, "default": 20}},
                        ],
                        "responses": {
                            "200": response("Paper attempts", ref("AttemptList")),
                            "401": error_response("Missing or invalid Supabase token"),
                        },
                    },
                },
                "/api/attempts/{attempt_id}": {
                    "get": {
                        "tags": ["Progress"],
                        "summary": "Get a paper attempt",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                        "parameters": [attempt_id_parameter()],
                        "responses": {
                            "200": response("Attempt details", ref("AttemptDetail")),
                            "401": error_response("Missing or invalid Supabase token"),
                            "403": error_response("Authenticated user does not own this attempt"),
                            "404": error_response("Attempt not found"),
                        },
                    },
                    "patch": {
                        "tags": ["Progress"],
                        "summary": "Update attempt progress",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                        "parameters": [attempt_id_parameter()],
                        "requestBody": json_request_body(
                            {
                                "type": "object",
                                "properties": {
                                    "elapsed_seconds": {"type": "integer", "minimum": 0},
                                    "questions_seen": {"type": "integer", "minimum": 0},
                                    "questions_answered": {"type": "integer", "minimum": 0},
                                    "reveal_count": {"type": "integer", "minimum": 0},
                                    "max_slide": {"type": "integer", "minimum": 0},
                                },
                            }
                        ),
                        "responses": {
                            "200": response("Attempt updated", ref("Attempt")),
                            "401": error_response("Missing or invalid Supabase token"),
                            "403": error_response("Authenticated user does not own this attempt"),
                            "404": error_response("Attempt not found"),
                        },
                    },
                    "delete": {
                        "tags": ["Progress"],
                        "summary": "Delete a paper attempt",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                        "parameters": [attempt_id_parameter()],
                        "responses": {
                            "200": message_response("Attempt deleted"),
                            "401": error_response("Missing or invalid Supabase token"),
                            "403": error_response("Authenticated user does not own this attempt"),
                            "404": error_response("Attempt not found"),
                        },
                    },
                },
                "/api/attempts/{attempt_id}/questions": {
                    "post": {
                        "tags": ["Progress"],
                        "summary": "Record question attempt timing",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                        "parameters": [attempt_id_parameter()],
                        "requestBody": json_request_body(ref("QuestionAttempt")),
                        "responses": {
                            "200": response("Question timing", ref("QuestionAttempt")),
                            "400": error_response("question_id is required"),
                            "401": error_response("Missing or invalid Supabase token"),
                            "403": error_response("Authenticated user does not own this attempt"),
                            "404": error_response("Attempt not found"),
                        },
                    }
                },
                "/api/attempts/{attempt_id}/complete": {
                    "post": {
                        "tags": ["Progress"],
                        "summary": "Complete a paper attempt",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                        "parameters": [attempt_id_parameter()],
                        "requestBody": json_request_body(
                            {
                                "type": "object",
                                "properties": {
                                    "elapsed_seconds": {"type": "integer", "minimum": 0},
                                    "questions_seen": {"type": "integer", "minimum": 0},
                                    "questions_answered": {"type": "integer", "minimum": 0},
                                    "reveal_count": {"type": "integer", "minimum": 0},
                                    "max_slide": {"type": "integer", "minimum": 0},
                                    "question_times": {"type": "array", "items": ref("QuestionAttempt")},
                                },
                            }
                        ),
                        "responses": {
                            "200": response("Completed attempt", ref("AttemptDetail")),
                            "401": error_response("Missing or invalid Supabase token"),
                            "403": error_response("Authenticated user does not own this attempt"),
                            "404": error_response("Attempt not found"),
                        },
                    }
                },
                "/api/attempts/stats": {
                    "get": {
                        "tags": ["Progress"],
                        "summary": "Get current user's attempt stats",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                        "responses": {
                            "200": response("Attempt stats", ref("StudentStats")),
                            "401": error_response("Missing or invalid Supabase token"),
                        },
                    }
                },
                "/api/stats/me": {
                    "get": {
                        "tags": ["Stats"],
                        "summary": "Get current user's student stats",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                        "responses": {
                            "200": response("Current user's stats", ref("MyStats")),
                            "401": error_response("Missing or invalid Supabase token"),
                            "404": error_response("User not found"),
                        },
                    }
                },
                "/api/stats/users": {
                    "get": {
                        "tags": ["Stats"],
                        "summary": "List all user stats",
                        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                        "responses": {
                            "200": response(
                                "All user stats",
                                {
                                    "type": "object",
                                    "properties": {"users": {"type": "array", "items": ref("StudentStatsUser")}},
                                    "required": ["users"],
                                },
                            ),
                            "401": error_response("Missing or invalid Supabase token"),
                            "403": error_response("Authenticated user is not an active admin"),
                        },
                    }
                },
            },
        }
    )


def register_blueprint(app):
    if PRODUCTION and not PUBLIC_API_DOCS:
        return

    swaggerui_blueprint = get_swaggerui_blueprint(
        SWAGGER_URL,
        API_URL,
        config={"app_name": "tppr-api"},
    )
    app.register_blueprint(swagger_bp)
    app.register_blueprint(swaggerui_blueprint)
