import { defineConfig } from '@prisma/config';

export default defineConfig({
  earlyAccess: true,
  datasource: {
    url: 'file:./dev.db',
  },
  migrate: {
    url: 'file:./dev.db',
  },
});
