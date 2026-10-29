import { rm, cp, writeFile } from 'node:fs/promises'

// Publishes the built client into /docs (the folder GitHub Pages serves) and
// stamps the build id so a cached copy can detect that a newer one exists.
await rm('../docs', { recursive: true, force: true })
await cp('dist', '../docs', { recursive: true })
await writeFile('../docs/.nojekyll', '')
await writeFile('../docs/version.json', JSON.stringify({ build: process.env.BUILD_ID || 'dev' }))
console.log('published docs for build', process.env.BUILD_ID || 'dev')
