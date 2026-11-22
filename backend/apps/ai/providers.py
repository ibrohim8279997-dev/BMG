"""Thin HTTP adapters. One interface: complete(system, prompt, web=False) -> (text, tokens_in, tokens_out).

Providers: claude (Anthropic), openai (Codex/GPT), gemini, grok (xAI), groq. Keys only from env.
"""
import requests
from django.conf import settings

TIMEOUT = 60


class ProviderError(Exception):
    pass


def _post(url, headers, payload):
    try:
        r = requests.post(url, headers=headers, json=payload, timeout=TIMEOUT)
    except requests.RequestException as e:  # do not leak URL/headers
        raise ProviderError(type(e).__name__)
    if r.status_code >= 400:
        raise ProviderError(f'http_{r.status_code}')
    return r.json()


def _openai_compat(url, key, model, system, prompt):
    d = _post(url, {'Authorization': f'Bearer {key}'},
              {'model': model, 'messages': [{'role': 'system', 'content': system},
                                            {'role': 'user', 'content': prompt}], 'max_tokens': 1500})
    u = d.get('usage') or {}
    return d['choices'][0]['message']['content'], u.get('prompt_tokens', 0), u.get('completion_tokens', 0)


def claude(key, model, system, prompt, web):
    payload = {'model': model, 'max_tokens': 1500, 'system': system,
               'messages': [{'role': 'user', 'content': prompt}]}
    if web:
        payload['tools'] = [{'type': 'web_search_20250305', 'name': 'web_search', 'max_uses': 3}]
    d = _post('https://api.anthropic.com/v1/messages',
              {'x-api-key': key, 'anthropic-version': '2023-06-01'}, payload)
    text = ''.join(b.get('text', '') for b in d.get('content', []) if b.get('type') == 'text')
    u = d.get('usage') or {}
    return text, u.get('input_tokens', 0), u.get('output_tokens', 0)


def openai(key, model, system, prompt, web):
    return _openai_compat('https://api.openai.com/v1/chat/completions', key, model, system, prompt)


def grok(key, model, system, prompt, web):
    return _openai_compat('https://api.x.ai/v1/chat/completions', key, model, system, prompt)


def groq(key, model, system, prompt, web):
    return _openai_compat('https://api.groq.com/openai/v1/chat/completions', key, model, system, prompt)


def gemini(key, model, system, prompt, web):
    d = _post(f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
              {'x-goog-api-key': key},
              {'systemInstruction': {'parts': [{'text': system}]},
               'contents': [{'role': 'user', 'parts': [{'text': prompt}]}]})
    parts = d['candidates'][0]['content']['parts']
    u = d.get('usageMetadata') or {}
    return ''.join(p.get('text', '') for p in parts), u.get('promptTokenCount', 0), u.get('candidatesTokenCount', 0)


REGISTRY = {'claude': claude, 'openai': openai, 'gemini': gemini, 'grok': grok, 'groq': groq}


def call(name, system, prompt, web=False):
    key = settings.AI_KEYS.get(name)
    if not key:
        raise ProviderError('no_key')
    return REGISTRY[name](key, settings.AI_MODELS[name], system, prompt, web)
