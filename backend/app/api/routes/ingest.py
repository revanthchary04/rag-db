import base64

import structlog
from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.schemas import (
    IngestRequest,
    IngestResponse,
)

logger = structlog.get_logger()

router = APIRouter()


def _decode_optional_ingest_original(req: IngestRequest) -> tuple[bytes | None, str | None]:
    """Validate optional base64 PDF payload from ingest."""
    if not req.original_file_base64:
        return None, None
    if req.original_media_type != "application/pdf":
        raise HTTPException(
            status_code=400,
            detail="original_media_type must be application/pdf when original_file_base64 is set",
        )
    try:
        raw = base64.b64decode(req.original_file_base64, validate=True)
    except Exception:
        raise HTTPException(status_code=400, detail="original_file_base64 is not valid base64")
    if len(raw) > settings.MAX_INGEST_ORIGINAL_FILE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=(
                "Original file exceeds maximum size "
                f"({settings.MAX_INGEST_ORIGINAL_FILE_BYTES} bytes after decoding)"
            ),
        )
    if not raw.startswith(b"%PDF"):
        raise HTTPException(status_code=400, detail="Original file must be a PDF")
    return raw, "application/pdf"


@router.post("/ingest", response_model=IngestResponse)
async def ingest_document_endpoint(
    request: Request,
    ingest_request: IngestRequest,
):
    """Ingest a document into the database."""
    request_id = getattr(request.state, "request_id", "unknown")

    # Validate payload size
    payload_size = len(ingest_request.text)
    if payload_size > settings.MAX_INGEST_PAYLOAD_SIZE:
        logger.warning(
            "Ingest payload too large",
            request_id=request_id,
            payload_size=payload_size,
            max_size=settings.MAX_INGEST_PAYLOAD_SIZE,
        )
        raise HTTPException(
            status_code=413,
            detail=f"Payload size ({payload_size} chars) exceeds maximum ({settings.MAX_INGEST_PAYLOAD_SIZE} chars)",
        )

    if not ingest_request.source.strip():
        raise HTTPException(
            status_code=400,
            detail="Source cannot be empty",
        )

    if not ingest_request.text.strip():
        raise HTTPException(
            status_code=400,
            detail="Text content cannot be empty",
        )

    original_bytes, original_media_type = _decode_optional_ingest_original(ingest_request)

    try:
        from app.rag.ingest import (
            DocumentTooLargeError,
            IngestError,
            ingest_document,
        )

        result = await ingest_document(
            source=ingest_request.source,
            title=ingest_request.title,
            text=ingest_request.text,
            is_markdown=ingest_request.is_markdown,
            original_bytes=original_bytes,
            original_media_type=original_media_type,
        )

        logger.info(
            "Document ingested successfully",
            request_id=request_id,
            document_id=result["document_id"],
            chunks_created=result["chunks_created"],
            replaced_existing=result.get("replaced_existing", False),
            preprocess_delta=result["preprocessing"]["character_delta"],
            undersized_merges=result["chunking"]["undersized_chunk_merges"],
        )

        return IngestResponse(**result)

    except DocumentTooLargeError as e:
        logger.warning(
            "Document too large",
            request_id=request_id,
            error=str(e),
        )
        raise HTTPException(
            status_code=413,
            detail=str(e),
        )

    except IngestError as e:
        logger.error(
            "Ingestion error",
            request_id=request_id,
            error=str(e),
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail=str(e),
        )

    except Exception as e:
        logger.error(
            "Unexpected ingestion error",
            request_id=request_id,
            error=str(e),
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail="Internal server error during ingestion",
        )


@router.post("/extract-text")
async def extract_text_endpoint(
    request: Request,
    file: UploadFile = File(...),
):
    """Extract text from PDF or DOCX files."""
    request_id = getattr(request.state, "request_id", "unknown")

    # Validate file type
    file_extension = file.filename.split(".")[-1].lower() if file.filename else ""
    if file_extension not in ["pdf", "docx"]:
        raise HTTPException(
            status_code=400,
            detail="Unsupported file type. Only PDF and DOCX files are supported.",
        )

    try:
        # Read file content
        file_content = await file.read()

        # Extract text based on file type
        from io import BytesIO

        if file_extension == "pdf":
            try:
                import PyPDF2

                pdf_file = BytesIO(file_content)
                pdf_reader = PyPDF2.PdfReader(pdf_file)
                text = ""
                for page in pdf_reader.pages:
                    text += page.extract_text() + "\n\n"
                text = text.strip()
            except ImportError:
                # Fallback to pdfplumber if PyPDF2 is not available
                try:
                    import pdfplumber

                    with pdfplumber.open(BytesIO(file_content)) as pdf:
                        text = "\n\n".join([page.extract_text() or "" for page in pdf.pages])
                    text = text.strip()
                except ImportError:
                    raise HTTPException(
                        status_code=500,
                        detail="PDF extraction library not installed. Please install PyPDF2 or pdfplumber.",
                    )
        elif file_extension == "docx":
            try:
                from docx import Document

                docx_file = BytesIO(file_content)
                doc = Document(docx_file)
                text = "\n\n".join([paragraph.text for paragraph in doc.paragraphs])
                text = text.strip()
            except ImportError:
                raise HTTPException(
                    status_code=500,
                    detail="DOCX extraction library not installed. Please install python-docx.",
                )

        if not text:
            raise HTTPException(
                status_code=400,
                detail="No text could be extracted from the file.",
            )

        logger.info(
            "Text extracted successfully",
            request_id=request_id,
            filename=file.filename,
            file_type=file_extension,
            text_length=len(text),
        )

        return JSONResponse(content={"text": text})

    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            "Text extraction error",
            request_id=request_id,
            filename=file.filename,
            error=str(e),
            exc_info=True,
        )
        raise HTTPException(
            status_code=500,
            detail=f"Failed to extract text from file: {str(e)}",
        )
