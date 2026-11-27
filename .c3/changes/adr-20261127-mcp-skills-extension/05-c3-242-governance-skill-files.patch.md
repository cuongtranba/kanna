---
target: c3-242
scope: block
base: c3-242#n14722@v1:sha256:5a2c1ecc8842cb1115e4f57f69cab5c7df712deb4b037a8313a546219b1c4b07
---
| ref-ws-subscription | ref | Tools reuse router topics and commands instead of reading the store | must follow | upload\_attachment, read\_project\_file and the skill:// files are the documented exceptions (skill files are read from disk through nodeSkillFiles, which refuses symlinks and dot-dot paths, within the SDK limit of 512 files and 16 MiB per skill), and get\_chat reads an older page through the same store method chat.loadHistory calls |
