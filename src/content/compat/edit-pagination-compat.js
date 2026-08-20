/*
 * ChatGPT edited-message pagination compatibility layer.
 *
 * ChatGPT currently gates in-place edited-message branch navigation behind
 * Statsig layer 2404437118. Some experiment variants hide the legacy branch
 * arrows or replace in-place switching with a "continue in a new chat" modal.
 *
 * This script must run in the page's MAIN world at document_start so ChatGPT
 * consumes normalized config values during bootstrap. It only touches the
 * edit-pagination experiment fields; conversation data and requests are left
 * unchanged.
 *
 * Strategy informed by the public chatgpt-edit-pagination-patch project and
 * OpenAI Developer Community reports about the affected Statsig layer.
 */

(() => {
  'use strict';

  const EDIT_LAYER_ID = '2404437118';
  const KNOWN_EXPERIMENT_IDS = new Set([
    '3879630193', // warning
    '3879348497', // branch_prefill
    '1973873291'  // variant_modal
  ]);
  const EDIT_PARAMETER_NAMES = new Set([
    'hide_pagination',
    'edit_buttons_hidden',
    'edit_actions_treatment',
    'edit_warning',
    'variant_modal'
  ]);

  const CONFIG_MARKER = /hide_pagination|edit_actions_treatment|variant_modal/;
  const CONFIG_RESPONSE_URL = /statsig|initialize|bootstrap/i;
  const CONFIG_CONTENT_TYPE = /json|javascript|text|html/i;
  const MAX_JSON_STRING_DEPTH = 2;

  const originalParse = JSON.parse;

  function hasCoreEditShape(value) {
    return Boolean(
      value &&
      typeof value === 'object' &&
      'hide_pagination' in value &&
      'edit_actions_treatment' in value
    );
  }

  function applyDefaultEditBehavior(value) {
    if (!value || typeof value !== 'object') return false;

    value.hide_pagination = false;
    value.edit_buttons_hidden = false;
    value.edit_actions_treatment = 'default';
    value.edit_warning = 'none';
    value.variant_modal = false;
    return true;
  }

  function normalizeExperimentConfig(config, force = false) {
    if (!config || typeof config !== 'object' || !config.value || typeof config.value !== 'object') {
      return false;
    }

    const knownExperiment = KNOWN_EXPERIMENT_IDS.has(String(config.allocated_experiment_name || ''));
    if (!force && !knownExperiment && !hasCoreEditShape(config.value)) return false;

    applyDefaultEditBehavior(config.value);
    config.group_name = 'Control';
    config.is_user_in_experiment = false;
    config.explicit_parameters = Array.isArray(config.explicit_parameters)
      ? config.explicit_parameters.filter(name => !EDIT_PARAMETER_NAMES.has(name))
      : [];
    return true;
  }

  function patchTextFallback(text) {
    if (typeof text !== 'string' || !CONFIG_MARKER.test(text)) return text;
    if (!text.includes('hide_pagination') && !text.includes('variant_modal')) return text;

    return text
      .replace(/("hide_pagination"\s*:\s*)true/g, '$1false')
      .replace(/(\\"hide_pagination\\"\s*:\s*)true/g, '$1false')
      .replace(/("edit_buttons_hidden"\s*:\s*)true/g, '$1false')
      .replace(/(\\"edit_buttons_hidden\\"\s*:\s*)true/g, '$1false')
      .replace(/("edit_actions_treatment"\s*:\s*)"(?:warning|branch_prefill)"/g, '$1"default"')
      .replace(/(\\"edit_actions_treatment\\"\s*:\s*)\\"(?:warning|branch_prefill)\\"/g, '$1\\"default\\"')
      .replace(/("edit_warning"\s*:\s*)"warning"/g, '$1"none"')
      .replace(/(\\"edit_warning\\"\s*:\s*)\\"warning\\"/g, '$1\\"none\\"')
      .replace(/("variant_modal"\s*:\s*)true/g, '$1false')
      .replace(/(\\"variant_modal\\"\s*:\s*)true/g, '$1false');
  }

  function patchPossiblyJsonText(text, jsonStringDepth) {
    if (typeof text !== 'string' || !CONFIG_MARKER.test(text)) return text;

    if (jsonStringDepth <= MAX_JSON_STRING_DEPTH) {
      try {
        const parsed = originalParse.call(JSON, text);
        if (parsed && typeof parsed === 'object') {
          return JSON.stringify(patchObject(parsed, jsonStringDepth));
        }
      } catch {
        // Not standalone JSON. Use narrowly-scoped textual replacements below.
      }
    }

    return patchTextFallback(text);
  }

  function patchObject(root, jsonStringDepth = 0) {
    if (!root || typeof root !== 'object') return root;

    const seen = new WeakSet();

    const walk = (object) => {
      if (!object || typeof object !== 'object' || seen.has(object)) return;
      seen.add(object);

      if (object.layer_configs && typeof object.layer_configs === 'object') {
        const editLayer = object.layer_configs[EDIT_LAYER_ID];
        if (editLayer) normalizeExperimentConfig(editLayer, true);

        for (const config of Object.values(object.layer_configs)) {
          normalizeExperimentConfig(config, false);
        }
      }

      normalizeExperimentConfig(object, false);

      if (hasCoreEditShape(object)) {
        applyDefaultEditBehavior(object);
      }

      for (const key of Object.keys(object)) {
        const value = object[key];
        if (typeof value === 'string') {
          object[key] = patchPossiblyJsonText(value, jsonStringDepth + 1);
        } else {
          walk(value);
        }
      }
    };

    walk(root);
    return root;
  }

  JSON.parse = function patchedJsonParse(text, reviver) {
    const parsed = originalParse.call(this, text, reviver);
    return typeof text === 'string' && CONFIG_MARKER.test(text)
      ? patchObject(parsed, 0)
      : parsed;
  };

  if (typeof Response !== 'undefined' && Response.prototype?.json) {
    const originalResponseJson = Response.prototype.json;
    Response.prototype.json = function patchedResponseJson(...args) {
      const parsedPromise = originalResponseJson.apply(this, args);
      const url = String(this.url || '');
      const contentType = this.headers?.get?.('content-type') || '';

      if (
        !CONFIG_RESPONSE_URL.test(url) ||
        !CONFIG_CONTENT_TYPE.test(contentType) ||
        /text\/event-stream/i.test(contentType)
      ) {
        return parsedPromise;
      }

      return parsedPromise.then(parsed => {
        if (typeof parsed === 'string') return patchPossiblyJsonText(parsed, 0);
        return patchObject(parsed, 0);
      });
    };
  }

  if (globalThis.__CHATGPT_GRAPH_EDIT_PAGINATION_COMPAT_TEST__ === true) {
    globalThis.__chatgptGraphEditPaginationCompat = {
      EDIT_LAYER_ID,
      applyDefaultEditBehavior,
      normalizeExperimentConfig,
      patchObject,
      patchPossiblyJsonText
    };
  }
})();
