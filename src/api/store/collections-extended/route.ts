import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

/**
 * GET /store/collections-extended
 * Get all collections with their metadata (description, image)
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
) {
  try {
    const productService = req.scope.resolve(Modules.PRODUCT)
    
    const limit = parseInt(req.query.limit as string) || 20
    const offset = parseInt(req.query.offset as string) || 0

    const [collections, count] = await productService.listAndCountProductCollections(
      {},
      {
        select: ["id", "title", "handle", "metadata", "created_at", "updated_at"],
        skip: offset,
        take: limit,
      }
    )

    const collectionsWithMetadata = collections.map((collection: any) => ({
      id: collection.id,
      title: collection.title,
      handle: collection.handle,
      created_at: collection.created_at,
      updated_at: collection.updated_at,
      description: collection.metadata?.description || null,
      image_url: collection.metadata?.image_url || null,
    }))

    return res.json({
      collections: collectionsWithMetadata,
      count,
      offset,
      limit,
    })
  } catch (error: any) {
    console.error("Error fetching collections:", error)
    return res.status(500).json({
      message: "Error fetching collections",
      error: error.message,
    })
  }
}
