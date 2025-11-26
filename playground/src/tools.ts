import { interrupt } from "@langchain/langgraph";
import { tool } from "langchain";
import { z } from "zod";

export const addToOrder = tool(
  ({ item, quantity }) => {
    if (item === "ham") {
      item = interrupt("Sorry, we don't have ham. Please choose another item.");
      if (!["turkey", "roast beef"].includes(item)) {
        throw new Error(
          "Sorry, can you please choose either turkey or roast beef?"
        );
      }
    }
    return `Added ${quantity} x ${item} to the order.`;
  },
  {
    name: "add_to_order",
    description: "Add an item to the customer's sandwich order.",
    schema: z.object({
      item: z
        .string()
        .describe("The item to add (e.g., 'turkey', 'provolone', 'lettuce')."),
      quantity: z.number().describe("The quantity of the item."),
    }),
  }
);

export const confirmOrder = tool(
  ({ orderSummary }) => {
    return `Order confirmed: ${orderSummary}. Sending to kitchen.`;
  },
  {
    name: "confirm_order",
    description: "Confirm the final order with the customer.",
    schema: z.object({
      orderSummary: z.string().describe("A summary of the confirmed order."),
    }),
  }
);

export const hangUp = tool(
  ({ reason }) => {
    return `Call ended: ${reason}`;
  },
  {
    name: "hang_up",
    description:
      "End the call. Use when the conversation has concluded or the customer says goodbye.",
    schema: z.object({
      reason: z.string().describe("Brief reason for ending the call."),
    }),
  }
);
