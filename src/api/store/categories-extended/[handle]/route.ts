import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { Modules } from "@medusajs/framework/utils"

/**
 * GET /store/categories-extended/:handle
 * Get a single category by handle with its metadata (image)
 */
export async function GET(
  req: MedusaRequest,
  res: MedusaResponse
) {
  try {
    const { handle } = req.params
    const productService = req.scope.resolve(Modules.PRODUCT)
    const includeChildren = req.query.include_children === "true"
    const includeParent = req.query.include_parent === "true"

    const [categories] = await productService.listAndCountProductCategories(
      { 
        handle,
        is_active: true,
        is_internal: false,
      },
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
        relations: [
          ...(includeChildren ? ["category_children"] : []),
          ...(includeParent ? ["parent_category"] : []),
        ],
        take: 1,
      }
    )

    if (!categories || categories.length === 0) {
      return res.status(404).json({
        message: "Category not found",
      })
    }

    const category = categories[0] as any

    const categoryWithMetadata = {
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
      parent: includeParent && category.parent_category
        ? {
            id: category.parent_category.id,
            name: category.parent_category.name,
            handle: category.parent_category.handle,
            description: category.parent_category.description || null,
            image_url: category.parent_category.metadata?.image_url || null,
          }
        : undefined,
    }

    return res.json({
      category: categoryWithMetadata,
    })
  } catch (error: any) {
    console.error("Error fetching category:", error)
    return res.status(500).json({
      message: "Error fetching category",
      error: error.message,
    })
  }
}
