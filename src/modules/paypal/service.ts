import { AbstractPaymentProvider, MedusaError } from "@medusajs/framework/utils"
import { Logger } from "@medusajs/framework/types"
import {
  AuthorizePaymentInput,
  AuthorizePaymentOutput,
  CancelPaymentInput,
  CancelPaymentOutput,
  CapturePaymentInput,
  CapturePaymentOutput,
  DeletePaymentInput,
  DeletePaymentOutput,
  GetPaymentStatusInput,
  GetPaymentStatusOutput,
  InitiatePaymentInput,
  InitiatePaymentOutput,
  RefundPaymentInput,
  RefundPaymentOutput,
  RetrievePaymentInput,
  RetrievePaymentOutput,
  UpdatePaymentInput,
  UpdatePaymentOutput,
  ProviderWebhookPayload,
  WebhookActionResult,
  PaymentSessionStatus,
} from "@medusajs/framework/types"
import { BigNumber } from "@medusajs/framework/utils"

type PayPalOptions = {
  clientId: string
  clientSecret: string
  sandbox?: boolean
}

type InjectedDependencies = {
  logger: Logger
}

interface PayPalOrder {
  id: string
  status: string
  purchase_units: Array<{
    amount: {
      currency_code: string
      value: string
    }
    payments?: {
      captures?: Array<{
        id: string
        status: string
        amount: {
          currency_code: string
          value: string
        }
      }>
    }
  }>
}

class PayPalPaymentProviderService extends AbstractPaymentProvider<PayPalOptions> {
  static identifier = "paypal"

  protected logger_: Logger
  protected options_: PayPalOptions
  protected baseUrl: string

  constructor(container: InjectedDependencies, options: PayPalOptions) {
    super(container, options)
    this.logger_ = container.logger
    this.options_ = options
    this.baseUrl = options.sandbox !== false 
      ? "https://api-m.sandbox.paypal.com" 
      : "https://api-m.paypal.com"
  }

  static validateOptions(options: Record<string, unknown>) {
    if (!options.clientId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "PayPal Client ID is required"
      )
    }
    if (!options.clientSecret) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "PayPal Client Secret is required"
      )
    }
  }

  /**
   * Get PayPal access token
   */
  private async getAccessToken(): Promise<string> {
    const auth = Buffer.from(
      `${this.options_.clientId}:${this.options_.clientSecret}`
    ).toString("base64")

    const response = await fetch(`${this.baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${auth}`,
      },
      body: "grant_type=client_credentials",
    })

    if (!response.ok) {
      const error = await response.text()
      this.logger_.error(`PayPal auth error: ${error}`)
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Failed to authenticate with PayPal"
      )
    }

    const data = await response.json()
    return data.access_token
  }

  /**
   * Make authenticated request to PayPal API
   */
  private async paypalRequest<T>(
    endpoint: string,
    method: string = "GET",
    body?: Record<string, unknown>
  ): Promise<T> {
    const accessToken = await this.getAccessToken()

    const options: RequestInit = {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    }

    if (body) {
      options.body = JSON.stringify(body)
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, options)

    if (!response.ok) {
      const error = await response.text()
      this.logger_.error(`PayPal API error: ${error}`)
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `PayPal API error: ${response.status}`
      )
    }

    return response.json()
  }

  /**
   * Initialize a payment session - creates a PayPal order
   */
  async initiatePayment(
    input: InitiatePaymentInput
  ): Promise<InitiatePaymentOutput> {
    const { amount, currency_code, data } = input

    // Log the incoming amount to debug
    this.logger_.info(`PayPal initiatePayment - Raw amount received: ${amount}, type: ${typeof amount}, currency: ${currency_code}`)

    // Medusa v2 sends amount as a decimal number (e.g., 400.00 for $400)
    // NOT in cents like Medusa v1. So we should NOT divide by 100.
    const amountValue = Number(amount).toFixed(2)

    // Get custom properties from input data
    const returnUrl = (data?.return_url as string) || "https://example.com/return"
    const cancelUrl = (data?.cancel_url as string) || "https://example.com/cancel"
    const description = (data?.payment_description as string) || "Medusa Store Purchase"

    const orderData = {
      intent: "CAPTURE",
      purchase_units: [
        {
          amount: {
            currency_code: currency_code.toUpperCase(),
            value: amountValue,
          },
          description,
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            payment_method_preference: "IMMEDIATE_PAYMENT_REQUIRED",
            brand_name: "Medusa Store",
            locale: "en-US",
            landing_page: "LOGIN",
            user_action: "PAY_NOW",
            return_url: returnUrl,
            cancel_url: cancelUrl,
          },
        },
      },
    }

    try {
      const order = await this.paypalRequest<PayPalOrder>(
        "/v2/checkout/orders",
        "POST",
        orderData
      )

      this.logger_.info(`PayPal order created: ${order.id}`)

      return {
        id: order.id,
        data: {
          id: order.id,
          status: order.status,
        },
      }
    } catch (error) {
      this.logger_.error(`Failed to create PayPal order: ${error}`)
      throw error
    }
  }

  /**
   * Authorize the payment
   */
  async authorizePayment(
    input: AuthorizePaymentInput
  ): Promise<AuthorizePaymentOutput> {
    const orderId = input.data?.id as string

    if (!orderId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "PayPal order ID is required"
      )
    }

    try {
      // Get order status from PayPal
      const order = await this.paypalRequest<PayPalOrder>(
        `/v2/checkout/orders/${orderId}`,
        "GET"
      )

      // Map PayPal status to Medusa status
      let status: PaymentSessionStatus = "pending"
      
      if (order.status === "APPROVED" || order.status === "COMPLETED") {
        status = "authorized"
      } else if (order.status === "VOIDED") {
        status = "canceled"
      }

      return {
        status,
        data: {
          id: orderId,
          paypal_status: order.status,
        },
      }
    } catch (error) {
      this.logger_.error(`Failed to authorize PayPal payment: ${error}`)
      return {
        status: "error",
        data: {
          id: orderId,
          error: String(error),
        },
      }
    }
  }

  /**
   * Capture the payment - actually charges the customer
   */
  async capturePayment(
    input: CapturePaymentInput
  ): Promise<CapturePaymentOutput> {
    const orderId = input.data?.id as string

    if (!orderId) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "PayPal order ID is required"
      )
    }

    try {
      const captureResult = await this.paypalRequest<PayPalOrder>(
        `/v2/checkout/orders/${orderId}/capture`,
        "POST"
      )

      // Extract capture ID from the response
      const captureId = captureResult.purchase_units?.[0]?.payments?.captures?.[0]?.id
      const captureAmount = captureResult.purchase_units?.[0]?.payments?.captures?.[0]?.amount

      this.logger_.info(`PayPal payment captured: ${orderId}, capture_id: ${captureId}`)

      return {
        data: {
          id: orderId,
          capture_id: captureId,
          paypal_status: captureResult.status,
          captured: true,
          currency_code: captureAmount?.currency_code,
        },
      }
    } catch (error) {
      this.logger_.error(`Failed to capture PayPal payment: ${error}`)
      throw error
    }
  }

  /**
   * Cancel a payment
   */
  async cancelPayment(
    input: CancelPaymentInput
  ): Promise<CancelPaymentOutput> {
    const orderId = input.data?.id as string

    // PayPal orders that haven't been captured can't be explicitly cancelled
    // They will expire automatically after 3 hours if not approved
    this.logger_.info(`PayPal order cancelled: ${orderId}`)

    return {
      data: {
        id: orderId,
        cancelled: true,
      },
    }
  }

  /**
   * Refund a payment
   */
  async refundPayment(
    input: RefundPaymentInput
  ): Promise<RefundPaymentOutput> {
    const captureId = input.data?.capture_id as string
    const amount = input.amount

    this.logger_.info(`PayPal refundPayment - data received: ${JSON.stringify(input.data)}, amount: ${amount}, amount type: ${typeof amount}`)

    if (!captureId) {
      this.logger_.error(`PayPal refund failed - No capture_id in payment data. Available data: ${JSON.stringify(input.data)}`)
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "PayPal capture ID is required for refunds. The payment may not have been captured properly."
      )
    }

    try {
      const refundData: Record<string, unknown> = {}
      
      if (amount !== undefined && amount !== null) {
        // Handle BigNumber or regular number - convert to string first then parse
        let amountNum: number
        if (typeof amount === 'object' && amount !== null) {
          // It might be a BigNumber object, try to get its value
          amountNum = Number(amount.toString())
        } else {
          amountNum = Number(amount)
        }

        this.logger_.info(`PayPal refund - Parsed amount: ${amountNum}`)

        if (!isNaN(amountNum) && amountNum > 0) {
          const amountValue = amountNum.toFixed(2)
          refundData.amount = {
            value: amountValue,
            currency_code: input.data?.currency_code || "USD",
          }
          this.logger_.info(`PayPal refund - Sending amount: ${amountValue} ${input.data?.currency_code || "USD"}`)
        }
      }

      // If no amount specified, PayPal will refund the full capture amount
      this.logger_.info(`PayPal refund - Request data: ${JSON.stringify(refundData)}`)

      const refundResult = await this.paypalRequest(
        `/v2/payments/captures/${captureId}/refund`,
        "POST",
        Object.keys(refundData).length > 0 ? refundData : undefined
      )

      this.logger_.info(`PayPal payment refunded: ${captureId}`)

      return {
        data: {
          ...input.data,
          refund: refundResult,
        },
      }
    } catch (error) {
      this.logger_.error(`Failed to refund PayPal payment: ${error}`)
      throw error
    }
  }

  /**
   * Delete/cancel a payment session
   */
  async deletePayment(
    input: DeletePaymentInput
  ): Promise<DeletePaymentOutput> {
    // PayPal orders expire automatically, no explicit deletion needed
    return {
      data: input.data,
    }
  }

  /**
   * Get payment status
   */
  async getPaymentStatus(
    input: GetPaymentStatusInput
  ): Promise<GetPaymentStatusOutput> {
    const orderId = input.data?.id as string

    if (!orderId) {
      return { status: "pending" }
    }

    try {
      const order = await this.paypalRequest<PayPalOrder>(
        `/v2/checkout/orders/${orderId}`,
        "GET"
      )

      switch (order.status) {
        case "COMPLETED":
          return { status: "captured" }
        case "APPROVED":
          return { status: "authorized" }
        case "VOIDED":
          return { status: "canceled" }
        case "CREATED":
        case "SAVED":
        case "PAYER_ACTION_REQUIRED":
          return { status: "pending" }
        default:
          return { status: "pending" }
      }
    } catch (error) {
      this.logger_.error(`Failed to get PayPal payment status: ${error}`)
      return { status: "error" }
    }
  }

  /**
   * Retrieve payment data
   */
  async retrievePayment(
    input: RetrievePaymentInput
  ): Promise<RetrievePaymentOutput> {
    const orderId = input.data?.id as string

    if (!orderId) {
      return {
        data: input.data || {},
      }
    }

    try {
      const order = await this.paypalRequest<PayPalOrder>(
        `/v2/checkout/orders/${orderId}`,
        "GET"
      )

      return {
        data: {
          id: order.id,
          status: order.status,
          paypal_order: order,
        },
      }
    } catch (error) {
      this.logger_.error(`Failed to retrieve PayPal payment: ${error}`)
      return {
        data: input.data || {},
      }
    }
  }

  /**
   * Update payment session
   */
  async updatePayment(
    input: UpdatePaymentInput
  ): Promise<UpdatePaymentOutput> {
    const orderId = input.data?.id as string
    const { amount, currency_code } = input

    if (!orderId) {
      // If no order exists, create a new one
      const newPayment = await this.initiatePayment({
        amount,
        currency_code,
        context: input.context,
      })
      return {
        data: newPayment.data,
      }
    }

    // PayPal doesn't support updating order amounts easily
    // The recommended approach is to create a new order
    try {
      const result = await this.initiatePayment({
        amount,
        currency_code,
        context: input.context,
      })

      return {
        data: result.data,
      }
    } catch (error) {
      this.logger_.error(`Failed to update PayPal payment: ${error}`)
      throw error
    }
  }

  /**
   * Handle webhook events from PayPal
   */
  async getWebhookActionAndData(
    payload: ProviderWebhookPayload["payload"]
  ): Promise<WebhookActionResult> {
    const { data } = payload

    try {
      const eventType = data?.event_type as string
      const resource = data?.resource as Record<string, unknown>

      switch (eventType) {
        case "CHECKOUT.ORDER.APPROVED":
          return {
            action: "authorized",
            data: {
              session_id: resource?.id as string,
              // PayPal sends amount as decimal (400.00), Medusa v2 also uses decimal
              amount: new BigNumber(
                Number((resource as any)?.purchase_units?.[0]?.amount?.value || 0)
              ),
            },
          }

        case "PAYMENT.CAPTURE.COMPLETED":
          return {
            action: "captured",
            data: {
              session_id: (resource as any)?.supplementary_data?.related_ids?.order_id as string,
              // PayPal sends amount as decimal (400.00), Medusa v2 also uses decimal
              amount: new BigNumber(
                Number((resource as any)?.amount?.value || 0)
              ),
            },
          }

        case "PAYMENT.CAPTURE.REFUNDED":
          // Refunds are handled separately, just log and return not_supported
          this.logger_.info(`PayPal refund webhook received for order: ${(resource as any)?.supplementary_data?.related_ids?.order_id}`)
          return {
            action: "not_supported",
          }

        default:
          return {
            action: "not_supported",
          }
      }
    } catch (error) {
      this.logger_.error(`PayPal webhook error: ${error}`)
      return {
        action: "not_supported",
      }
    }
  }
}

export default PayPalPaymentProviderService
