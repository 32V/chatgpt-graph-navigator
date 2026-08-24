import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.__CHATGPT_GRAPH_EDIT_PAGINATION_COMPAT_TEST__ = true;
await import('../src/content/compat/edit-pagination-compat.js');
const compat = globalThis.__chatgptGraphEditPaginationCompat;

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

test('edited-message compatibility stays narrowly scoped to the known layer', () => {
  assert.ok(compat, 'compatibility helpers were not exposed');

  const modalPayload = {
    layer_configs: {
      [compat.EDIT_LAYER_ID]: makeLayer()
    }
  };
  compat.patchObject(modalPayload);
  const modalLayer = modalPayload.layer_configs[compat.EDIT_LAYER_ID];
  assert.equal(modalLayer.value.variant_modal, false);
  assert.equal(modalLayer.value.hide_pagination, false);
  assert.equal(modalLayer.value.edit_actions_treatment, 'default');
  assert.equal(modalLayer.is_user_in_experiment, false);
  assert.equal(modalLayer.group_name, 'Control');
  assert.deepEqual(modalLayer.explicit_parameters, []);

  const branchPayload = {
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
  compat.patchObject(branchPayload);
  const branchLayer = branchPayload.layer_configs[compat.EDIT_LAYER_ID];
  assert.equal(branchLayer.value.hide_pagination, false);
  assert.equal(branchLayer.value.edit_actions_treatment, 'default');
  assert.equal(branchLayer.value.variant_modal, false);
  assert.deepEqual(branchLayer.explicit_parameters, ['unrelated']);

  const minimalPayload = {
    layer_configs: {
      [compat.EDIT_LAYER_ID]: makeLayer({ value: { variant_modal: true } })
    }
  };
  compat.patchObject(minimalPayload);
  assert.deepEqual(minimalPayload.layer_configs[compat.EDIT_LAYER_ID].value, {
    variant_modal: false,
    hide_pagination: false,
    edit_buttons_hidden: false,
    edit_actions_treatment: 'default',
    edit_warning: 'none'
  });

  const inner = {
    layer_configs: {
      [compat.EDIT_LAYER_ID]: makeLayer()
    }
  };
  const outer = { statsigPayload: JSON.stringify(inner) };
  compat.patchObject(outer);
  assert.equal(
    JSON.parse(outer.statsigPayload).layer_configs[compat.EDIT_LAYER_ID].value.variant_modal,
    false
  );

  const unrelated = { feature: { variant_modal: true, enabled: true } };
  compat.patchObject(unrelated);
  assert.deepEqual(unrelated, { feature: { variant_modal: true, enabled: true } });
});
