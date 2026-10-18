import { Resvg } from '@resvg/resvg-js'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const publicDir = resolve(here, '..', 'public')
mkdirSync(publicDir, { recursive: true })

function render(svgPath, size) {
  const svg = readFileSync(svgPath, 'utf8')
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
    background: 'rgba(0,0,0,0)',
  })
  return resvg.render().asPng()
}

const mainSvg = resolve(publicDir, 'favicon.svg')
const maskSvg = resolve(here, 'icon-maskable.svg')

writeFileSync(resolve(publicDir, 'icon-192.png'), render(mainSvg, 192))
writeFileSync(resolve(publicDir, 'icon-512.png'), render(mainSvg, 512))
writeFileSync(resolve(publicDir, 'icon-maskable-512.png'), render(maskSvg, 512))
writeFileSync(resolve(publicDir, 'apple-touch-icon.png'), render(mainSvg, 180))
writeFileSync(resolve(publicDir, 'favicon.png'), render(mainSvg, 48))

console.log('Icons generated in', publicDir)
