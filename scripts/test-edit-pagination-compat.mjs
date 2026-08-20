import assert from 'node:assert/strict';

// Ask the compatibility script to expose its pure helpers for this process.
globalThis.__CHATGPT_GRAPH_EDIT_PAGINATION_COMPAT_TEST__ = true;
await import('../src/content/compat/edit-pagination-compat.js');

const compat = globalThis.__chatgptGraphEditPaginationCompat;
assert.ok(compat, 'compatibility helpers were not exposed');

function makeLayer({
  experiment = '1973873291',
  group = 'Test',
  explicit = ['variant_modal'],
  value = {
    hide_pagination: false,
    edit_buttons_hidden: false,
    edit_actions_treatment: 'default',
    edit_warning: 'none',
    variant_modal: true
  }
} = {}) {
  return {
    allocated_experiment_name: experiment,
    group_name: group,
    is_user_in_experiment: true,
    explicit_parameters: explicit,
    value: { ...value }
  };
}

// New variant-modal experiment: versions should stay in the same conversation.
{
  const payload = {
    layer_configs: {
      [compat.EDIT_LAYER_ID]: makeLayer()
    }
  };
  compat.patchObject(payload);
  const layer = payload.layer_configs[compat.EDIT_LAYER_ID];
  assert.equal(layer.value.variant_modal, false);
  assert.equal(layer.value.hide_pagination, false);
  assert.equal(layer.value.edit_actions_treatment, 'default');
  assert.equal(layer.is_user_in_experiment, false);
  assert.equal(layer.group_name, 'Control');
  assert.deepEqual(layer.explicit_parameters, []);
}

// Older branch-prefill experiment: legacy pagination must be restored.
{
  const payload = {
    layer_configs: {
      [compat.EDIT_LAYER_ID]: makeLayer({
        experiment: '3879348497',
        group: 'Branch Prefill',
        explicit: ['hide_pagination', 'edit_actions_treatment', 'unrelated'],
        value: {
          hide_pagination: true,
          edit_buttons_hidden: false,
          edit_actions_treatment: 'branch_prefill',
          edit_warning: 'none'
        }
      })
    }
  };
  compat.patchObject(payload);
  const layer = payload.layer_configs[compat.EDIT_LAYER_ID];
  assert.equal(layer.value.hide_pagination, false);
  assert.equal(layer.value.edit_actions_treatment, 'default');
  assert.equal(layer.value.variant_modal, false);
  assert.deepEqual(layer.explicit_parameters, ['unrelated']);
}

// The layer ID is authoritative even if a future payload only includes the new flag.
{
  const payload = {
    layer_configs: {
      [compat.EDIT_LAYER_ID]: makeLayer({ value: { variant_modal: true } })
    }
  };
  compat.patchObject(payload);
  const value = payload.layer_configs[compat.EDIT_LAYER_ID].value;
  assert.deepEqual(value, {
    variant_modal: false,
    hide_pagination: false,
    edit_buttons_hidden: false,
    edit_actions_treatment: 'default',
    edit_warning: 'none'
  });
}

// client-bootstrap commonly embeds Statsig JSON as a JSON string.
{
  const inner = {
    layer_configs: {
      [compat.EDIT_LAYER_ID]: makeLayer()
    }
  };
  const outer = { statsigPayload: JSON.stringify(inner) };
  compat.patchObject(outer);
  const reparsed = JSON.parse(outer.statsigPayload);
  assert.equal(reparsed.layer_configs[compat.EDIT_LAYER_ID].value.variant_modal, false);
}

// Do not mutate unrelated uses of similarly named fields outside the known layer/shape.
{
  const unrelated = { feature: { variant_modal: true, enabled: true } };
  compat.patchObject(unrelated);
  assert.deepEqual(unrelated, { feature: { variant_modal: true, enabled: true } });
}

console.log('edit-pagination compatibility tests passed');
