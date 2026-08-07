import { env } from "../config/env.js";
import { recordMetric } from "./metrics.service.js";
export async function completeChat(provider, messages) {
    recordMetric(`llm.${provider}.requests`);
    try {
        const result = provider === "openrouter" ? await completeOpenRouter(messages) : await completeOllama(messages);
        recordMetric(`llm.${provider}.successes`);
        return result;
    }
    catch (error) {
        recordMetric(`llm.${provider}.failures`);
        throw error;
    }
}
export async function* streamChat(provider, messages, signal) {
    const response = provider === "openrouter"
        ? await openRouterResponse(messages, signal, true)
        : await ollamaResponse(messages, signal, true);
    if (!response.body)
        throw new Error("LLM provider returned an empty stream");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
                const content = provider === "openrouter" ? parseOpenRouterLine(line) : parseOllamaLine(line);
                if (content)
                    yield content;
            }
        }
    }
    finally {
        reader.releaseLock();
    }
}
async function completeOllama(messages) {
    const response = await ollamaResponse(messages, AbortSignal.timeout(120_000), false);
    if (!response.ok)
        throw new Error(`Ollama chat failed (${response.status})`);
    const payload = (await response.json());
    return payload.message?.content ?? "";
}
async function completeOpenRouter(messages) {
    if (!env.OPENROUTER_API_KEY || env.OPENROUTER_API_KEY === "your_key_here") {
        throw new Error("OPENROUTER_API_KEY is not configured");
    }
    const response = await openRouterResponse(messages, AbortSignal.timeout(120_000), false);
    if (!response.ok)
        throw new Error(`OpenRouter chat failed (${response.status})`);
    const payload = (await response.json());
    return payload.choices?.[0]?.message?.content ?? "";
}
async function ollamaResponse(messages, signal, stream) {
    const response = await fetch(`${env.OLLAMA_URL}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: env.OLLAMA_CHAT_MODEL, messages, stream }),
        signal,
    });
    if (!response.ok)
        throw new Error(`Ollama chat failed (${response.status})`);
    return response;
}
async function openRouterResponse(messages, signal, stream) {
    if (!env.OPENROUTER_API_KEY || env.OPENROUTER_API_KEY === "your_key_here") {
        throw new Error("OPENROUTER_API_KEY is not configured");
    }
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
            "content-type": "application/json",
            authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
            "http-referer": "http://localhost:3000",
            "x-title": "DevPilot AI",
        },
        body: JSON.stringify({ model: env.OPENROUTER_MODEL, messages, stream }),
        signal,
    });
    if (!response.ok)
        throw new Error(`OpenRouter chat failed (${response.status})`);
    return response;
}
function parseOllamaLine(line) {
    if (!line.trim())
        return "";
    try {
        const payload = JSON.parse(line);
        return payload.message?.content ?? "";
    }
    catch {
        return "";
    }
}
function parseOpenRouterLine(line) {
    if (!line.startsWith("data:"))
        return "";
    const value = line.slice(5).trim();
    if (value === "[DONE]")
        return "";
    try {
        const payload = JSON.parse(value);
        return payload.choices?.[0]?.delta?.content ?? "";
    }
    catch {
        return "";
    }
}
