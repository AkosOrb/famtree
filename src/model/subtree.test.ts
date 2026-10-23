import { describe, expect, it } from 'vitest';
import { buildIndex } from './graph';
import { generateTree, sampleTree } from './sample';
import { focusSubtree } from './subtree';
import { fullName } from './types';

describe('focusSubtree', () => {
  it('keeps ancestors, descendants, partners and siblings around the focus person', () => {
    const t = sampleTree();
    const index = buildIndex(t);
    const istvan = Object.values(t.persons).find((p) => fullName(p) === 'Kovács István')!.id;
    const view = focusSubtree(t, index, istvan, 1, 1);
    const names = Object.values(view.tree.persons).map(fullName).sort();
    expect(names).toEqual(
      ['Kovács János', 'Szabó Mária', 'Kovács István', 'Tóth Éva', 'Kovács Katalin', 'Kovács Ferenc', 'Kovács Gábor', 'Horváth Lilla', 'Kovács Zsófia'].sort(),
    );
    // Gábor and Lilla have a hidden child, Katalin a hidden partner.
    const truncated = [...view.truncated].map((id) => fullName(t.persons[id])).sort();
    expect(truncated).toEqual(['Horváth Lilla', 'Kovács Gábor', 'Kovács Katalin']);
    for (const u of Object.values(view.tree.unions)) {
      [...u.partners, ...u.children].forEach((id) => expect(view.tree.persons[id]).toBeDefined());
    }
  });

  it('stays small inside a large tree', () => {
    const t = generateTree(5000);
    const root = Object.keys(t.persons)[100];
    const view = focusSubtree(t, buildIndex(t), root, 3, 3);
    expect(Object.keys(view.tree.persons).length).toBeLessThan(200);
  });
});
