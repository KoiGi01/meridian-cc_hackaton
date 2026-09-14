import { describe, expect, it } from 'vitest';
import { isDestructive } from './assemble';

describe('isDestructive', () => {
  it.each(['Delete', 'Remove item', 'Eliminar', 'Borrar', 'Logout', 'Log out', 'Sign out', 'Cerrar sesión'])(
    'flags "%s"',
    (name) => {
      expect(isDestructive(name)).toBe(true);
    },
  );

  it.each(['Export', 'Add new product', 'Login', 'Sign in', 'Deleted orders'])('leaves "%s" alone', (name) => {
    expect(isDestructive(name)).toBe(false);
  });
});
