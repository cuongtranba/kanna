#!/usr/bin/env bun
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '../../')
const SRC = path.join(ROOT, 'CHANGELOG.md')
const DST = path.join(import.meta.dir, '../src/content/docs/changelog.md')

const body = await Bun.file(SRC).text()
const wrapped = `---
title: Changelog
description: Release notes for @cuongtran001/kanna.
---

${body}
`

await Bun.write(DST, wrapped)
console.log(`Wrote ${DST}`)
