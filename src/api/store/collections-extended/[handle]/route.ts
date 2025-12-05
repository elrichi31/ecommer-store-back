import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

/**
 * GET /store/collections-extended/:handle
 * Get a single collection by handle with its metadata
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
) {
  const { handle } = req.params

  try {
    const productService = req.scope.resolve(Modules.PRODUCT)
    
    // Get collection by handle
    const collections = await productService.listProductCollections(
      { handle },
      {
        select: ["id", "title", "handle", "metadata", "created_at", "updated_at"],
      }
    )

    if (!collections || collections.length === 0) {
      return res.status(404).json({
        message: "Collection not found",
      })
    }

    const collection = collections[0]

    return res.json({
      collection: {
        id: collection.id,
        title: collection.title,
        handle: collection.handle,
        created_at: collection.created_at,
        updated_at: collection.updated_at,
        description: collection.metadata?.description || null,
        image_url: collection.metadata?.image_url || null,
      },
    })
  } catch (error: any) {
    console.error("Error fetching collection:", error)
    return res.status(500).json({
      message: "Error fetching collection",
      error: error.message,
    })
  }
}
