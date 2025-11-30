import { CreateInventoryLevelInput, ExecArgs } from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils";
import {
  createApiKeysWorkflow,
  createInventoryLevelsWorkflow,
  createProductCategoriesWorkflow,
  createProductsWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createShippingOptionsWorkflow,
  createShippingProfilesWorkflow,
  createStockLocationsWorkflow,
  createTaxRegionsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
  updateStoresStep,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows";
import {
  createWorkflow,
  transform,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";

const updateStoreCurrencies = createWorkflow(
  "update-store-currencies",
  (input: {
    supported_currencies: { currency_code: string; is_default?: boolean }[];
    store_id: string;
  }) => {
    const normalizedInput = transform({ input }, (data) => {
      return {
        selector: { id: data.input.store_id },
        update: {
          supported_currencies: data.input.supported_currencies.map(
            (currency) => {
              return {
                currency_code: currency.currency_code,
                is_default: currency.is_default ?? false,
              };
            }
          ),
        },
      };
    });

    const stores = updateStoresStep(normalizedInput);

    return new WorkflowResponse(stores);
  }
);

export default async function seedDemoData({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const link = container.resolve(ContainerRegistrationKeys.LINK);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const fulfillmentModuleService = container.resolve(Modules.FULFILLMENT);
  const salesChannelModuleService = container.resolve(Modules.SALES_CHANNEL);
  const storeModuleService = container.resolve(Modules.STORE);

  const southAmericaCountries = ["ec", "pe"];

  logger.info("Seeding store data...");
  const [store] = await storeModuleService.listStores();
  let defaultSalesChannel = await salesChannelModuleService.listSalesChannels({
    name: "Default Sales Channel",
  });

  if (!defaultSalesChannel.length) {
    // create the default sales channel
    const { result: salesChannelResult } = await createSalesChannelsWorkflow(
      container
    ).run({
      input: {
        salesChannelsData: [
          {
            name: "Default Sales Channel",
          },
        ],
      },
    });
    defaultSalesChannel = salesChannelResult;
  }

  await updateStoreCurrencies(container).run({
    input: {
      store_id: store.id,
      supported_currencies: [
        {
          currency_code: "usd",
          is_default: true,
        },
        {
          currency_code: "pen",
        },
      ],
    },
  });

  await updateStoresWorkflow(container).run({
    input: {
      selector: { id: store.id },
      update: {
        default_sales_channel_id: defaultSalesChannel[0].id,
      },
    },
  });
  logger.info("Seeding region data...");
  const { result: regionResult } = await createRegionsWorkflow(container).run({
    input: {
      regions: [
        {
          name: "América del Sur",
          currency_code: "usd",
          countries: southAmericaCountries,
          payment_providers: ["pp_system_default"],
        },
      ],
    },
  });
  const southAmericaRegion = regionResult[0];
  logger.info("Finished seeding regions.");

  logger.info("Seeding tax regions...");
  await createTaxRegionsWorkflow(container).run({
    input: [
      ...southAmericaCountries.map((country_code) => ({
        country_code,
        provider_id: "tp_system",
      })),
    ],
  });
  logger.info("Finished seeding tax regions.");

  logger.info("Seeding stock location data...");
  const { result: stockLocationResult } = await createStockLocationsWorkflow(
    container
  ).run({
    input: {
      locations: [
        {
          name: "Bodega Principal",
          address: {
            city: "Guayaquil",
            country_code: "EC",
            address_1: "Av. Francisco de Orellana",
          },
        },
      ],
    },
  });
  const stockLocation = stockLocationResult[0];

  await updateStoresWorkflow(container).run({
    input: {
      selector: { id: store.id },
      update: {
        default_location_id: stockLocation.id,
      },
    },
  });

  await link.create({
    [Modules.STOCK_LOCATION]: {
      stock_location_id: stockLocation.id,
    },
    [Modules.FULFILLMENT]: {
      fulfillment_provider_id: "manual_manual",
    },
  });

  logger.info("Seeding fulfillment data...");
  const shippingProfiles = await fulfillmentModuleService.listShippingProfiles({
    type: "default",
  });
  let shippingProfile = shippingProfiles.length ? shippingProfiles[0] : null;

  if (!shippingProfile) {
    const { result: shippingProfileResult } =
      await createShippingProfilesWorkflow(container).run({
        input: {
          data: [
            {
              name: "Default Shipping Profile",
              type: "default",
            },
          ],
        },
      });
    shippingProfile = shippingProfileResult[0];
  }

  const fulfillmentSet = await fulfillmentModuleService.createFulfillmentSets({
    name: "Envíos Internacionales",
    type: "shipping",
    service_zones: [
      {
        name: "Ecuador",
        geo_zones: [
          {
            country_code: "ec",
            type: "country",
          },
        ],
      },
      {
        name: "Perú",
        geo_zones: [
          {
            country_code: "pe",
            type: "country",
          },
        ],
      },
    ],
  });

  await link.create({
    [Modules.STOCK_LOCATION]: {
      stock_location_id: stockLocation.id,
    },
    [Modules.FULFILLMENT]: {
      fulfillment_set_id: fulfillmentSet.id,
    },
  });

  // Opciones de envío para Ecuador y Perú
  await createShippingOptionsWorkflow(container).run({
    input: [
      {
        name: "Envío Ecuador",
        price_type: "flat",
        provider_id: "manual_manual",
        service_zone_id: fulfillmentSet.service_zones[0].id, // Ecuador
        shipping_profile_id: shippingProfile.id,
        type: {
          label: "Estándar",
          description: "Entrega en 3-5 días hábiles.",
          code: "standard-ec",
        },
        prices: [
          {
            currency_code: "usd",
            amount: 300, // $3 USD
          },
          {
            region_id: southAmericaRegion.id,
            amount: 300,
          },
        ],
        rules: [
          {
            attribute: "enabled_in_store",
            value: "true",
            operator: "eq",
          },
          {
            attribute: "is_return",
            value: "false",
            operator: "eq",
          },
        ],
      },
      {
        name: "Envío Perú",
        price_type: "flat",
        provider_id: "manual_manual",
        service_zone_id: fulfillmentSet.service_zones[1].id, // Perú
        shipping_profile_id: shippingProfile.id,
        type: {
          label: "Estándar",
          description: "Entrega en 3-5 días hábiles.",
          code: "standard-pe",
        },
        prices: [
          {
            currency_code: "pen",
            amount: 1000, // 10 PEN
          },
          {
            region_id: southAmericaRegion.id,
            amount: 1000,
          },
        ],
        rules: [
          {
            attribute: "enabled_in_store",
            value: "true",
            operator: "eq",
          },
          {
            attribute: "is_return",
            value: "false",
            operator: "eq",
          },
        ],
      },
    ],
  });
  logger.info("Finished seeding fulfillment data.");

  await linkSalesChannelsToStockLocationWorkflow(container).run({
    input: {
      id: stockLocation.id,
      add: [defaultSalesChannel[0].id],
    },
  });
  logger.info("Finished seeding stock location data.");

  logger.info("Seeding publishable API key data...");
  const { result: publishableApiKeyResult } = await createApiKeysWorkflow(
    container
  ).run({
    input: {
      api_keys: [
        {
          title: "Webshop",
          type: "publishable",
          created_by: "",
        },
      ],
    },
  });
  const publishableApiKey = publishableApiKeyResult[0];

  await linkSalesChannelsToApiKeyWorkflow(container).run({
    input: {
      id: publishableApiKey.id,
      add: [defaultSalesChannel[0].id],
    },
  });
  logger.info("Finished seeding publishable API key data.");

  logger.info("Seeding product data...");

  const { result: categoryResult } = await createProductCategoriesWorkflow(
    container
  ).run({
    input: {
      product_categories: [
        {
          name: "Camisetas",
          is_active: true,
        },
        {
          name: "Pantalones",
          is_active: true,
        },
        {
          name: "Accesorios",
          is_active: true,
        },
        {
          name: "Calzado",
          is_active: true,
        },
      ],
    },
  });

  await createProductsWorkflow(container).run({
    input: {
      products: [
        {
          title: "Camiseta Básica Algodón",
          category_ids: [
            categoryResult.find((cat) => cat.name === "Camisetas")!.id,
          ],
          description:
            "Camiseta básica de algodón 100% premium. Perfecta para el día a día, suave y cómoda.",
          handle: "camiseta-basica",
          weight: 200,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          images: [
            {
              url: "https://medusa-public-images.s3.eu-west-1.amazonaws.com/tee-black-front.png",
            },
          ],
          options: [
            {
              title: "Talla",
              values: ["S", "M", "L"],
            },
            {
              title: "Color",
              values: ["Negro", "Blanco"],
            },
          ],
          variants: [
            {
              title: "S / Negro",
              sku: "CAM-BASIC-S-NEG",
              options: {
                Talla: "S",
                Color: "Negro",
              },
              prices: [
                {
                  amount: 1500, // $15 USD
                  currency_code: "usd",
                },
                {
                  amount: 4500, // 45 PEN
                  currency_code: "pen",
                },
              ],
            },
            {
              title: "M / Negro",
              sku: "CAM-BASIC-M-NEG",
              options: {
                Talla: "M",
                Color: "Negro",
              },
              prices: [
                {
                  amount: 1500,
                  currency_code: "usd",
                },
                {
                  amount: 4500,
                  currency_code: "pen",
                },
              ],
            },
            {
              title: "L / Negro",
              sku: "CAM-BASIC-L-NEG",
              options: {
                Talla: "L",
                Color: "Negro",
              },
              prices: [
                {
                  amount: 1500,
                  currency_code: "usd",
                },
                {
                  amount: 4500,
                  currency_code: "pen",
                },
              ],
            },
            {
              title: "S / Blanco",
              sku: "CAM-BASIC-S-BLA",
              options: {
                Talla: "S",
                Color: "Blanco",
              },
              prices: [
                {
                  amount: 1500,
                  currency_code: "usd",
                },
                {
                  amount: 4500,
                  currency_code: "pen",
                },
              ],
            },
            {
              title: "M / Blanco",
              sku: "CAM-BASIC-M-BLA",
              options: {
                Talla: "M",
                Color: "Blanco",
              },
              prices: [
                {
                  amount: 1500,
                  currency_code: "usd",
                },
                {
                  amount: 4500,
                  currency_code: "pen",
                },
              ],
            },
            {
              title: "L / Blanco",
              sku: "CAM-BASIC-L-BLA",
              options: {
                Talla: "L",
                Color: "Blanco",
              },
              prices: [
                {
                  amount: 1500,
                  currency_code: "usd",
                },
                {
                  amount: 4500,
                  currency_code: "pen",
                },
              ],
            },
          ],
          sales_channels: [
            {
              id: defaultSalesChannel[0].id,
            },
          ],
        },
        {
          title: "Jean Clásico",
          category_ids: [
            categoryResult.find((cat) => cat.name === "Pantalones")!.id,
          ],
          description:
            "Jean clásico de corte recto, confeccionado en denim de alta calidad. Perfecto para cualquier ocasión.",
          handle: "jean-clasico",
          weight: 600,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          images: [
            {
              url: "https://medusa-public-images.s3.eu-west-1.amazonaws.com/sweatpants-gray-front.png",
            },
          ],
          options: [
            {
              title: "Talla",
              values: ["28", "30", "32", "34"],
            },
          ],
          variants: [
            {
              title: "28",
              sku: "JEAN-CLA-28",
              options: {
                Talla: "28",
              },
              prices: [
                {
                  amount: 3500, // $35 USD
                  currency_code: "usd",
                },
                {
                  amount: 12000, // 120 PEN
                  currency_code: "pen",
                },
              ],
            },
            {
              title: "30",
              sku: "JEAN-CLA-30",
              options: {
                Talla: "30",
              },
              prices: [
                {
                  amount: 3500,
                  currency_code: "usd",
                },
                {
                  amount: 12000,
                  currency_code: "pen",
                },
              ],
            },
            {
              title: "32",
              sku: "JEAN-CLA-32",
              options: {
                Talla: "32",
              },
              prices: [
                {
                  amount: 3500,
                  currency_code: "usd",
                },
                {
                  amount: 12000,
                  currency_code: "pen",
                },
              ],
            },
            {
              title: "34",
              sku: "JEAN-CLA-34",
              options: {
                Talla: "34",
              },
              prices: [
                {
                  amount: 3500,
                  currency_code: "usd",
                },
                {
                  amount: 12000,
                  currency_code: "pen",
                },
              ],
            },
          ],
          sales_channels: [
            {
              id: defaultSalesChannel[0].id,
            },
          ],
        },
        {
          title: "Gorra Deportiva",
          category_ids: [
            categoryResult.find((cat) => cat.name === "Accesorios")!.id,
          ],
          description:
            "Gorra deportiva ajustable con diseño moderno. Material transpirable ideal para actividades al aire libre.",
          handle: "gorra-deportiva",
          weight: 150,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          images: [
            {
              url: "https://medusa-public-images.s3.eu-west-1.amazonaws.com/tee-black-front.png",
            },
          ],
          options: [
            {
              title: "Color",
              values: ["Negro", "Azul", "Rojo"],
            },
          ],
          variants: [
            {
              title: "Negro",
              sku: "GORRA-NEG",
              options: {
                Color: "Negro",
              },
              prices: [
                {
                  amount: 1200, // $12 USD
                  currency_code: "usd",
                },
                {
                  amount: 3500, // 35 PEN
                  currency_code: "pen",
                },
              ],
            },
            {
              title: "Azul",
              sku: "GORRA-AZU",
              options: {
                Color: "Azul",
              },
              prices: [
                {
                  amount: 1200,
                  currency_code: "usd",
                },
                {
                  amount: 3500,
                  currency_code: "pen",
                },
              ],
            },
            {
              title: "Rojo",
              sku: "GORRA-ROJ",
              options: {
                Color: "Rojo",
              },
              prices: [
                {
                  amount: 1200,
                  currency_code: "usd",
                },
                {
                  amount: 3500,
                  currency_code: "pen",
                },
              ],
            },
          ],
          sales_channels: [
            {
              id: defaultSalesChannel[0].id,
            },
          ],
        },
        {
          title: "Zapatillas Deportivas",
          category_ids: [
            categoryResult.find((cat) => cat.name === "Calzado")!.id,
          ],
          description:
            "Zapatillas deportivas cómodas con suela antideslizante. Perfectas para correr o uso diario.",
          handle: "zapatillas-deportivas",
          weight: 800,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          images: [
            {
              url: "https://medusa-public-images.s3.eu-west-1.amazonaws.com/sweatshirt-vintage-front.png",
            },
          ],
          options: [
            {
              title: "Talla",
              values: ["38", "39", "40", "41", "42"],
            },
          ],
          variants: [
            {
              title: "38",
              sku: "ZAP-DEP-38",
              options: {
                Talla: "38",
              },
              prices: [
                {
                  amount: 5500, // $55 USD
                  currency_code: "usd",
                },
                {
                  amount: 18000, // 180 PEN
                  currency_code: "pen",
                },
              ],
            },
            {
              title: "39",
              sku: "ZAP-DEP-39",
              options: {
                Talla: "39",
              },
              prices: [
                {
                  amount: 5500,
                  currency_code: "usd",
                },
                {
                  amount: 18000,
                  currency_code: "pen",
                },
              ],
            },
            {
              title: "40",
              sku: "ZAP-DEP-40",
              options: {
                Talla: "40",
              },
              prices: [
                {
                  amount: 5500,
                  currency_code: "usd",
                },
                {
                  amount: 18000,
                  currency_code: "pen",
                },
              ],
            },
            {
              title: "41",
              sku: "ZAP-DEP-41",
              options: {
                Talla: "41",
              },
              prices: [
                {
                  amount: 5500,
                  currency_code: "usd",
                },
                {
                  amount: 18000,
                  currency_code: "pen",
                },
              ],
            },
            {
              title: "42",
              sku: "ZAP-DEP-42",
              options: {
                Talla: "42",
              },
              prices: [
                {
                  amount: 5500,
                  currency_code: "usd",
                },
                {
                  amount: 18000,
                  currency_code: "pen",
                },
              ],
            },
          ],
          sales_channels: [
            {
              id: defaultSalesChannel[0].id,
            },
          ],
        },
      ],
    },
  });
  logger.info("Finished seeding product data.");

  logger.info("Seeding inventory levels.");

  const { data: inventoryItems } = await query.graph({
    entity: "inventory_item",
    fields: ["id", "sku"],
  });

  const inventoryLevels: CreateInventoryLevelInput[] = [];
  for (const inventoryItem of inventoryItems) {
    // Stock variado y realista entre 5 y 25 unidades por variante
    const stockQuantity = Math.floor(Math.random() * 21) + 5;
    const inventoryLevel = {
      location_id: stockLocation.id,
      stocked_quantity: stockQuantity,
      inventory_item_id: inventoryItem.id,
    };
    inventoryLevels.push(inventoryLevel);
  }

  await createInventoryLevelsWorkflow(container).run({
    input: {
      inventory_levels: inventoryLevels,
    },
  });

  logger.info("Finished seeding inventory levels data.");
}
