-- Correlate persisted chat turns with queries.request_id / queries row and optional eval harness IDs.
-- Foreign key on query_log_id is applied by Alembic revision 005_chat_message_observability.
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS request_id TEXT;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS query_log_id TEXT;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS eval_run_id TEXT;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS eval_case_id TEXT;
CREATE INDEX IF NOT EXISTS chat_messages_request_id_idx ON chat_messages (request_id);
CREATE INDEX IF NOT EXISTS chat_messages_query_log_id_idx ON chat_messages (query_log_id);
CREATE INDEX IF NOT EXISTS chat_messages_eval_run_case_idx ON chat_messages (eval_run_id, eval_case_id);
