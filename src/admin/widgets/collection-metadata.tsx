import { defineWidgetConfig } from "@medusajs/admin-sdk"
import { Container, Heading, Text, Textarea, Button, DropdownMenu, IconButton, Drawer, Label, clx } from "@medusajs/ui"
import { DetailWidgetProps, AdminCollection } from "@medusajs/framework/types"
import { useState, useEffect, useRef } from "react"
import { EllipsisHorizontal, Photo, XMarkMini, ArrowUpTray, PencilSquare, Trash } from "@medusajs/icons"
import { sdk } from "../lib/sdk"

type AdminProductCollection = AdminCollection

const CollectionMetadataWidget = ({ data }: DetailWidgetProps<AdminProductCollection>) => {
  // Current saved values
  const [savedDescription, setSavedDescription] = useState("")
  const [savedImageUrl, setSavedImageUrl] = useState("")
  
  // Edit form values
  const [editDescription, setEditDescription] = useState("")
  const [editImageUrl, setEditImageUrl] = useState("")
  
  // UI state
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Load from collection's native metadata
  useEffect(() => {
    if (data?.metadata) {
      const desc = (data.metadata as any)?.description || ""
      const img = (data.metadata as any)?.image_url || ""
      setSavedDescription(desc)
      setSavedImageUrl(img)
      setEditDescription(desc)
      setEditImageUrl(img)
    }
  }, [data])

  const handleOpenDrawer = () => {
    setEditDescription(savedDescription)
    setEditImageUrl(savedImageUrl)
    setIsDrawerOpen(true)
  }

  const handleCloseDrawer = () => {
    setIsDrawerOpen(false)
  }

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (!file.type.startsWith("image/")) {
      alert("Solo se permiten archivos de imagen")
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      alert("La imagen no debe superar 5MB")
      return
    }

    setIsUploading(true)

    try {
      const result = await sdk.admin.upload.create({
        files: [file],
      })
      
      if (result.files && result.files.length > 0) {
        setEditImageUrl(result.files[0].url)
      }
    } catch (error: any) {
      console.error("Upload error:", error)
      alert(error.message || "Error al subir imagen")
    } finally {
      setIsUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
    }
  }

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await sdk.admin.productCollection.update(data.id, {
        metadata: {
          ...((data.metadata as object) || {}),
          description: editDescription || null,
          image_url: editImageUrl || null,
        },
      })

      setSavedDescription(editDescription)
      setSavedImageUrl(editImageUrl)
      setIsDrawerOpen(false)
    } catch (error: any) {
      console.error("Save error:", error)
      alert(error.message || "Error al guardar")
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm("¿Estás seguro de eliminar la descripción e imagen?")) {
      return
    }

    setIsSaving(true)
    try {
      await sdk.admin.productCollection.update(data.id, {
        metadata: {
          ...((data.metadata as object) || {}),
          description: null,
          image_url: null,
        },
      })

      setSavedDescription("")
      setSavedImageUrl("")
      setEditDescription("")
      setEditImageUrl("")
    } catch (error: any) {
      console.error("Delete error:", error)
      alert(error.message || "Error al eliminar")
    } finally {
      setIsSaving(false)
    }
  }

  const hasContent = savedDescription || savedImageUrl

  return (
    <>
      <Container className="divide-y p-0">
        {/* Header with dropdown menu */}
        <div className="flex items-center justify-between px-6 py-4">
          <Heading level="h2">Information</Heading>
          <DropdownMenu>
            <DropdownMenu.Trigger asChild>
              <IconButton variant="transparent" size="small">
                <EllipsisHorizontal />
              </IconButton>
            </DropdownMenu.Trigger>
            <DropdownMenu.Content align="end">
              <DropdownMenu.Item onClick={handleOpenDrawer}>
                <PencilSquare className="mr-2" />
                Edit Media
              </DropdownMenu.Item>
              {hasContent && (
                <DropdownMenu.Item onClick={handleDelete} className="text-ui-fg-error">
                  <Trash className="mr-2" />
                  Delete
                </DropdownMenu.Item>
              )}
            </DropdownMenu.Content>
          </DropdownMenu>
        </div>

        {/* Content display */}
        <div className="px-6 py-4">
          {hasContent ? (
            <div className="flex flex-col gap-y-4">
              {/* Image row */}
              <div className="grid grid-cols-2 items-start gap-x-6">
                <Text className="text-ui-fg-subtle text-sm font-medium">
                  Image
                </Text>
                {savedImageUrl ? (
                  <div className="w-40 h-40 rounded-lg overflow-hidden border border-ui-border-base bg-ui-bg-subtle">
                    <img
                      src={savedImageUrl}
                      alt="Collection"
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none"
                      }}
                    />
                  </div>
                ) : (
                  <Text className="text-ui-fg-muted text-sm">-</Text>
                )}
              </div>

              {/* Description row */}
              <div className="grid grid-cols-2 items-start gap-x-6">
                <Text className="text-ui-fg-subtle text-sm font-medium">
                  Description
                </Text>
                <Text className="text-ui-fg-base text-sm">
                  {savedDescription || "-"}
                </Text>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <div className="w-12 h-12 rounded-lg bg-ui-bg-subtle flex items-center justify-center mb-3">
                <Photo className="w-6 h-6 text-ui-fg-muted" />
              </div>
              <Text className="text-ui-fg-muted text-sm">
                No media added yet
              </Text>
              <Button
                variant="secondary"
                size="small"
                className="mt-3"
                onClick={handleOpenDrawer}
              >
                Add Media
              </Button>
            </div>
          )}
        </div>
      </Container>

      {/* Edit Drawer */}
      <Drawer open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
        <Drawer.Content className="z-50 right-0">
          <Drawer.Header>
            <Drawer.Title>Edit Media</Drawer.Title>
          </Drawer.Header>
          
          <Drawer.Body className="flex flex-col gap-y-6 p-6">
            {/* Description field */}
            <div className="flex flex-col gap-y-2">
              <Label htmlFor="description" className="text-ui-fg-subtle">
                Description
              </Label>
              <Textarea
                id="description"
                placeholder="Add a description for this collection..."
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                rows={4}
              />
              <Text className="text-ui-fg-muted text-xs">
                This description will be displayed in your storefront.
              </Text>
            </div>

            {/* Image upload section */}
            <div className="flex flex-col gap-y-2">
              <Label className="text-ui-fg-subtle">
                Image
              </Label>
              
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileUpload}
                className="hidden"
              />

              {editImageUrl ? (
                <div className="relative group">
                  <div className="w-full aspect-video rounded-lg overflow-hidden border border-ui-border-base">
                    <img
                      src={editImageUrl}
                      alt="Preview"
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <button
                    onClick={() => setEditImageUrl("")}
                    className="absolute top-2 right-2 bg-ui-bg-base border border-ui-border-base rounded-md p-1.5 shadow-sm hover:bg-ui-bg-base-hover"
                  >
                    <XMarkMini className="w-4 h-4 text-ui-fg-subtle" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploading}
                  className={clx(
                    "flex flex-col items-center justify-center w-full py-8",
                    "border-2 border-dashed border-ui-border-strong rounded-lg",
                    "bg-ui-bg-subtle hover:bg-ui-bg-subtle-hover transition-colors",
                    "cursor-pointer",
                    isUploading && "opacity-50 cursor-not-allowed"
                  )}
                >
                  {isUploading ? (
                    <>
                      <div className="w-6 h-6 border-2 border-ui-fg-subtle border-t-transparent rounded-full animate-spin mb-2" />
                      <Text className="text-ui-fg-subtle text-sm">Uploading...</Text>
                    </>
                  ) : (
                    <>
                      <ArrowUpTray className="w-5 h-5 text-ui-fg-muted mb-2" />
                      <Text className="text-ui-fg-subtle text-sm font-medium">
                        Upload image
                      </Text>
                      <Text className="text-ui-fg-muted text-xs">
                        Drag and drop or click to upload
                      </Text>
                    </>
                  )}
                </button>
              )}
            </div>
          </Drawer.Body>

          <Drawer.Footer>
            <Drawer.Close asChild>
              <Button variant="secondary" disabled={isSaving}>
                Cancel
              </Button>
            </Drawer.Close>
            <Button
              variant="primary"
              onClick={handleSave}
              isLoading={isSaving}
              disabled={isSaving || isUploading}
            >
              Save
            </Button>
          </Drawer.Footer>
        </Drawer.Content>
      </Drawer>
    </>
  )
}

export const config = defineWidgetConfig({
  zone: "product_collection.details.after",
})

export default CollectionMetadataWidget
