import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

/**
 * GET /store/categories-extended
 * Get all categories with their metadata (image)
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
) {
  try {
    const productService = req.scope.resolve(Modules.PRODUCT)
    
    const limit = parseInt(req.query.limit as string) || 100
    const offset = parseInt(req.query.offset as string) || 0
    const includeChildren = req.query.include_children === "true"
    const parentCategoryId = req.query.parent_category_id as string | undefined

    // Build filter
    const filters: any = {
      is_active: true,
      is_internal: false,
    }

    // If parent_category_id is provided, filter by it
    // If parent_category_id is "null", get root categories (no parent)
    if (parentCategoryId === "null") {
      filters.parent_category_id = null
    } else if (parentCategoryId) {
      filters.parent_category_id = parentCategoryId
    }

    const [categories, count] = await productService.listAndCountProductCategories(
      filters,
      {
        select: [
          "id", 
          "name", 
          "handle", 
          "description",
          "metadata", 
          "parent_category_id",
          "rank",
          "created_at", 
          "updated_at"
        ],
        relations: includeChildren ? ["category_children"] : [],
        skip: offset,
        take: limit,
        order: { rank: "ASC" },
      }
    )

    const categoriesWithMetadata = categories.map((category: any) => ({
      id: category.id,
      name: category.name,
      handle: category.handle,
      description: category.description || null,
      parent_category_id: category.parent_category_id || null,
      rank: category.rank,
      created_at: category.created_at,
      updated_at: category.updated_at,
      image_url: category.metadata?.image_url || null,
      children: includeChildren && category.category_children 
        ? category.category_children.map((child: any) => ({
            id: child.id,
            name: child.name,
            handle: child.handle,
            description: child.description || null,
            rank: child.rank,
            image_url: child.metadata?.image_url || null,
          }))
        : undefined,
    }))

    return res.json({
      categories: categoriesWithMetadata,
      count,
      offset,
      limit,
    })
  } catch (error: any) {
    console.error("Error fetching categories:", error)
    return res.status(500).json({
      message: "Error fetching categories",
      error: error.message,
    })
  }
}
