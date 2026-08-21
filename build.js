import esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');
const isRelease = process.argv.includes('--release');
const isDev = isWatch && !isRelease;

const commonOptions = {
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome115'],
  sourcemap: isDev ? 'inline' : false,
  minify: isRelease,
  pure: isRelease ? ['console.log', 'console.debug', 'console.info'] : [],
  define: {
    'process.env.NODE_ENV': isDev ? '"development"' : '"production"'
  },
  logLevel: 'info'
};

const reactOptions = {
  ...commonOptions,
  loader: {
    '.js': 'jsx',
    '.jsx': 'jsx'
  },
  jsx: 'automatic'
};

const builds = [
  {
    ...commonOptions,
    entryPoints: ['src/content/compat/edit-pagination-compat.js'],
    outfile: 'dist/edit-pagination-compat.js'
  },
  {
    ...commonOptions,
    entryPoints: ['src/content/ui/docked-panel.js'],
    outfile: 'dist/docked-panel.js'
  },
  {
    ...commonOptions,
    entryPoints: ['src/content/ui/docked-panel.css'],
    outfile: 'dist/docked-panel.css'
  },
  {
    ...commonOptions,
    entryPoints: ['src/content/index.js'],
    outfile: 'dist/content.js'
  },
  {
    ...commonOptions,
    entryPoints: ['src/background/index.js'],
    outfile: 'dist/background.js'
  },
  {
    ...commonOptions,
    entryPoints: ['src/popup/popup.js'],
    outfile: 'dist/popup.js'
  },
  {
    ...commonOptions,
    entryPoints: ['src/setup/setup.js'],
    outfile: 'dist/setup.js'
  },
  {
    ...reactOptions,
    entryPoints: ['src/sidepanel/index.jsx'],
    outfile: 'dist/sidepanel.js'
  },
  {
    ...commonOptions,
    entryPoints: ['src/sidepanel/styles/index.css'],
    outfile: 'dist/sidepanel.css'
  }
];

async function build() {
  try {
    if (isWatch) {
      console.log('Watching for changes...');
      const contexts = await Promise.all(builds.map(options => esbuild.context(options)));
      await Promise.all(contexts.map(context => context.watch()));
      return;
    }

    await Promise.all(builds.map(options => esbuild.build(options)));
    console.log(isRelease ? 'Release build completed.' : 'Build completed.');
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

void build();
