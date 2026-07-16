import structlog
from asyncpg.exceptions import ForeignKeyViolationError
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse

from app.db.chat_queries import (
    append_chat_message,
    create_chat_thread,
    delete_all_chat_threads,
    delete_chat_thread,
    get_chat_thread,
    list_chat_messages,
    list_chat_threads,
    update_chat_thread_title,
)
from app.schemas import (
    ChatMessageAppend,
    ChatMessageResponse,
    ChatMessagesListResponse,
    ChatThreadCreate,
    ChatThreadListResponse,
    ChatThreadResponse,
    ChatThreadUpdate,
)

logger = structlog.get_logger()

router = APIRouter()


@router.post("/chat/threads", response_model=ChatThreadResponse)
async def create_chat_thread_endpoint(body: ChatThreadCreate):
    """Create an empty chat thread."""
    row = await create_chat_thread(body.title)
    return ChatThreadResponse(**row, message_count=0)


@router.get("/chat/threads", response_model=ChatThreadListResponse)
async def list_chat_threads_endpoint(limit: int = Query(50, ge=1, le=200)):
    """List chat threads ordered by recent activity."""
    rows = await list_chat_threads(limit=limit, offset=0)
    return ChatThreadListResponse(
        threads=[
            ChatThreadResponse(
                id=r["id"],
                title=r["title"],
                created_at=r["created_at"],
                updated_at=r["updated_at"],
                message_count=r.get("message_count", 0),
            )
            for r in rows
        ]
    )


@router.delete("/chat/threads")
async def delete_all_chat_threads_endpoint():
    """Delete all chat threads and their messages."""
    n = await delete_all_chat_threads()
    return JSONResponse(
        status_code=200,
        content={"message": "All chat threads deleted", "deleted_count": n},
    )


@router.patch("/chat/threads/{thread_id}", response_model=ChatThreadResponse)
async def patch_chat_thread_endpoint(thread_id: str, body: ChatThreadUpdate):
    """Rename a chat thread."""
    existing = await get_chat_thread(thread_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Thread not found")
    updated = await update_chat_thread_title(thread_id, title=body.title)
    if not updated:
        raise HTTPException(status_code=404, detail="Thread not found")
    full = await get_chat_thread(thread_id)
    assert full is not None
    return ChatThreadResponse(
        id=full["id"],
        title=full["title"],
        created_at=full["created_at"],
        updated_at=full["updated_at"],
        message_count=full.get("message_count", 0),
    )


@router.delete("/chat/threads/{thread_id}")
async def delete_chat_thread_endpoint(thread_id: str):
    """Delete a chat thread and its messages."""
    deleted = await delete_chat_thread(thread_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Thread not found")
    return JSONResponse(
        status_code=200, content={"message": "Thread deleted", "thread_id": thread_id}
    )


@router.get("/chat/threads/{thread_id}/messages", response_model=ChatMessagesListResponse)
async def list_chat_messages_endpoint(thread_id: str):
    """List messages for a thread in chronological order."""
    thread = await get_chat_thread(thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    rows = await list_chat_messages(thread_id)
    return ChatMessagesListResponse(
        messages=[
            ChatMessageResponse(
                id=m["id"],
                thread_id=m["thread_id"],
                role=m["role"],
                content=m["content"],
                citations=m.get("citations") or [],
                metadata=m.get("metadata") or {},
                latency_ms=m.get("latency_ms"),
                cost_usd=m.get("cost_usd"),
                rag_model=m.get("rag_model"),
                seq=m["seq"],
                created_at=m.get("created_at"),
                request_id=m.get("request_id"),
                query_log_id=m.get("query_log_id"),
                eval_run_id=m.get("eval_run_id"),
                eval_case_id=m.get("eval_case_id"),
            )
            for m in rows
        ]
    )


@router.post("/chat/threads/{thread_id}/messages", response_model=ChatMessageResponse)
async def append_chat_message_endpoint(thread_id: str, body: ChatMessageAppend):
    """Persist one chat message."""
    thread = await get_chat_thread(thread_id)
    if not thread:
        raise HTTPException(status_code=404, detail="Thread not found")
    try:
        m = await append_chat_message(
            thread_id,
            role=body.role,
            content=body.content,
            citations=body.citations,
            metadata=body.metadata,
            latency_ms=body.latency_ms,
            cost_usd=body.cost_usd,
            rag_model=body.rag_model,
            request_id=body.request_id,
            query_log_id=body.query_log_id,
            eval_run_id=body.eval_run_id,
            eval_case_id=body.eval_case_id,
        )
    except ForeignKeyViolationError:
        raise HTTPException(
            status_code=400,
            detail="Invalid query_log_id: no matching queries row",
        )
    return ChatMessageResponse(
        id=m["id"],
        thread_id=m["thread_id"],
        role=m["role"],
        content=m["content"],
        citations=m.get("citations") or [],
        metadata=m.get("metadata") or {},
        latency_ms=m.get("latency_ms"),
        cost_usd=m.get("cost_usd"),
        rag_model=m.get("rag_model"),
        seq=m["seq"],
        created_at=m.get("created_at"),
        request_id=m.get("request_id"),
        query_log_id=m.get("query_log_id"),
        eval_run_id=m.get("eval_run_id"),
        eval_case_id=m.get("eval_case_id"),
    )
