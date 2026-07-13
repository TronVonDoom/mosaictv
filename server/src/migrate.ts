import { prisma } from './db.js'
import { log } from './logs.js'

const FLAG = 'migrated_collection_ownership'

/**
 * One-time migration to the "collection owned by a channel" model. Each existing
 * collection is assigned to the channel that references it (via a rotation item
 * or time block). A collection used by more than one channel is DUPLICATED per
 * channel (members + smart filter copied) and those channels' references are
 * repointed to their own copy. Collections referenced by no channel are left
 * unassigned. Idempotent — guarded by a Setting flag.
 */
export async function migrateCollectionOwnership(): Promise<void> {
  if (await prisma.setting.findUnique({ where: { key: FLAG } })) return

  const collections = await prisma.collection.findMany({ include: { items: true } })
  let duplicated = 0

  for (const col of collections) {
    const [rots, blks] = await Promise.all([
      prisma.rotationItem.findMany({ where: { collectionId: col.id }, select: { channelId: true } }),
      prisma.timeBlock.findMany({ where: { collectionId: col.id }, select: { channelId: true } }),
    ])
    const channelIds = [...new Set([...rots.map((r) => r.channelId), ...blks.map((b) => b.channelId)])]
    if (channelIds.length === 0) continue // orphan — leave unassigned

    // The first referencing channel keeps the original.
    await prisma.collection.update({ where: { id: col.id }, data: { channelId: channelIds[0] } })

    // Each additional channel gets its own duplicate.
    for (const chId of channelIds.slice(1)) {
      const dup = await prisma.collection.create({
        data: {
          name: col.name,
          channelId: chId,
          libraryId: col.libraryId,
          filterType: col.filterType,
          filterShow: col.filterShow,
          filterSearch: col.filterSearch,
          filterGenre: col.filterGenre,
        },
      })
      if (col.items.length) {
        await prisma.collectionItem.createMany({
          data: col.items.map((it) => ({
            collectionId: dup.id,
            kind: it.kind,
            showTitle: it.showTitle,
            libraryId: it.libraryId,
            mediaItemId: it.mediaItemId,
            label: it.label,
            order: it.order,
          })),
        })
      }
      await prisma.rotationItem.updateMany({ where: { channelId: chId, collectionId: col.id }, data: { collectionId: dup.id } })
      await prisma.timeBlock.updateMany({ where: { channelId: chId, collectionId: col.id }, data: { collectionId: dup.id } })
      duplicated++
    }
  }

  await prisma.setting.create({ data: { key: FLAG, value: new Date().toISOString() } })
  log('info', 'system', `Collection ownership migration complete — ${collections.length} collection(s), ${duplicated} duplicated for shared use`)
}
