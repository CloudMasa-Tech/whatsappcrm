import { describe, it, expect } from 'vitest';
import { STARTER_MESSAGE_TEMPLATES } from './starter-templates';
import { extractVariableIndices } from './template-validators';

describe('Starter WhatsApp Message Templates', () => {
  it('contains at least 10 ready-made templates', () => {
    expect(STARTER_MESSAGE_TEMPLATES.length).toBeGreaterThanOrEqual(10);
  });

  it('all starter templates have valid names and categories', () => {
    for (const tpl of STARTER_MESSAGE_TEMPLATES) {
      expect(tpl.name).toMatch(/^[a-z0-9_]+$/);
      expect(['Marketing', 'Utility']).toContain(tpl.category);
      expect(tpl.title).toBeTruthy();
      expect(tpl.body_text).toBeTruthy();
      expect(tpl.tags.length).toBeGreaterThan(0);
    }
  });

  it('verifies body variables match sample values', () => {
    for (const tpl of STARTER_MESSAGE_TEMPLATES) {
      const varIndices = extractVariableIndices(tpl.body_text);
      if (varIndices.length > 0) {
        expect(tpl.sample_values?.body).toBeDefined();
        expect(tpl.sample_values?.body?.length).toBeGreaterThanOrEqual(varIndices.length);
      }
    }
  });

  it('has unique slugs and names for each template', () => {
    const slugs = new Set<string>();
    const names = new Set<string>();

    for (const tpl of STARTER_MESSAGE_TEMPLATES) {
      expect(slugs.has(tpl.slug)).toBe(false);
      expect(names.has(tpl.name)).toBe(false);
      slugs.add(tpl.slug);
      names.add(tpl.name);
    }
  });
});
