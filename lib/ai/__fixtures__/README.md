# AI Prompt Fixtures for MockAnthropicClient

One JSON file per model ID. `MockAnthropicClient` (active when `AI_PROVIDER=mock`) reads
the file matching `params.model` and returns it as an `Anthropic.Message`.

## Naming convention

`{model-id}.json` — e.g. `claude-opus-4-7.json` for brand-voice inference.

## Shape

Each file must be a valid `Anthropic.Message` JSON object with at minimum:

```json
{
  "id": "msg_mock",
  "type": "message",
  "role": "assistant",
  "model": "<model-id>",
  "content": [{ "type": "text", "text": "<JSON string matching the prompt's outputSchema>" }],
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "usage": {
    "input_tokens": 350,
    "output_tokens": 120,
    "cache_read_input_tokens": 0,
    "cache_creation_input_tokens": 0
  }
}
```
