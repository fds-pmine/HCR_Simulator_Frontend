import * as Blockly from 'blockly/core';
import type { Challenge } from '../../types/domain';
import {
  createCutterGridToolbox,
  registerCutterGridBlocks,
} from '../cutter-grid/blockDefinitions';
import { BLOCK_FIELDS } from './blockConstants';
import { createToolbox, registerHcrBlocks } from './blockDefinitions';
import type { ProgrammingMode } from './programmingMode';
import type { AppLocale } from '../preferences/localization';

/**
 * Fields that must be applied before any other field on the same block.
 *
 * `JOINT_ID` is here because the angle field's validator reads it to decide the
 * legal range (`blockDefinitions.ts`), so an angle applied first is judged
 * against whichever joint the dropdown happens to be showing.
 */
const LEADING_FIELDS: readonly string[] = [BLOCK_FIELDS.jointId];

export function createHeadlessWorkspace(challenge: Challenge): Blockly.Workspace {
  return createHeadlessWorkspaceForMode(challenge, 'servo');
}

export function createHeadlessWorkspaceForMode(
  challenge: Challenge,
  mode: ProgrammingMode,
  state = initialWorkspaceState(challenge, mode),
): Blockly.Workspace {
  registerBlocksForMode(challenge, mode);
  const workspace = new Blockly.Workspace();
  loadWorkspaceState(workspace, state);
  return workspace;
}

export function registerBlocksForMode(
  challenge: Challenge,
  mode: ProgrammingMode,
  appLocale: AppLocale = 'en',
): void {
  registerHcrBlocks(challenge.robotConfig.joints, appLocale);
  if (mode === 'cutter-grid') {
    registerCutterGridBlocks(appLocale);
  }
}

export function toolboxForMode(
  challenge: Challenge,
  mode: ProgrammingMode,
  appLocale: AppLocale = 'en',
): Blockly.utils.toolbox.ToolboxDefinition {
  return mode === 'servo'
    ? createToolbox(challenge, appLocale)
    : createCutterGridToolbox(appLocale);
}

export function initialWorkspaceState(
  challenge: Challenge,
  mode: ProgrammingMode,
): Record<string, unknown> {
  return mode === 'servo' ? challenge.starterWorkspace : {};
}

export function loadWorkspaceState(
  workspace: Blockly.Workspace,
  state: Record<string, unknown>,
): void {
  workspace.clear();
  Blockly.serialization.workspaces.load(withLeadingFieldsFirst(state), workspace);
}

export function saveWorkspaceState(
  workspace: Blockly.Workspace,
): Record<string, unknown> {
  return Blockly.serialization.workspaces.save(workspace);
}

/**
 * Reorder every block's `fields` so {@link LEADING_FIELDS} are applied first.
 *
 * Blockly applies serialized fields in object-key order, and our angle
 * validator reads `JOINT_ID` to decide the legal range. But JSON promises
 * nothing about key order, and producers differ: the Rust backend serializes
 * through `serde_json::Value`, whose map is a `BTreeMap`, so it emits `ANGLE`
 * before `JOINT_ID` — alphabetically. Every angle was then validated against
 * the *default* joint, and the two outside its range were silently replaced by
 * the field's fallback. A served challenge loaded a starter program that was not
 * the one it shipped, with no error anywhere.
 *
 * Normalizing here fixes it for every producer at once, rather than asking each
 * of them to preserve an order the format does not guarantee.
 */
export function withLeadingFieldsFirst(
  state: Record<string, unknown>,
): Record<string, unknown> {
  const blocks = state.blocks;
  if (!isRecord(blocks) || !Array.isArray(blocks.blocks)) {
    return state;
  }
  return {
    ...state,
    blocks: { ...blocks, blocks: blocks.blocks.map(normalizeBlock) },
  };
}

function normalizeBlock(block: unknown): unknown {
  if (!isRecord(block)) {
    return block;
  }
  const normalized: Record<string, unknown> = { ...block };

  if (isRecord(block.fields)) {
    normalized.fields = orderFields(block.fields);
  }
  // `next` chains the statement below; `inputs` holds nested blocks such as a
  // repeat body. Both can carry set-joint-angle blocks, so both are walked.
  if (isRecord(block.next) && 'block' in block.next) {
    normalized.next = { ...block.next, block: normalizeBlock(block.next.block) };
  }
  if (isRecord(block.inputs)) {
    normalized.inputs = Object.fromEntries(
      Object.entries(block.inputs).map(([name, input]) => [
        name,
        isRecord(input) && 'block' in input
          ? { ...input, block: normalizeBlock(input.block) }
          : input,
      ]),
    );
  }

  return normalized;
}

function orderFields(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const leading = LEADING_FIELDS.filter((name) => name in fields);
  if (leading.length === 0) {
    return fields;
  }
  const rest = Object.keys(fields).filter((name) => !leading.includes(name));
  return Object.fromEntries(
    [...leading, ...rest].map((name) => [name, fields[name]]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
