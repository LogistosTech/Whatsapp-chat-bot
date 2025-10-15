import mongoose from "mongoose";

const bookShipmentSchema = new mongoose.Schema({
  phone: { type: String, required: true, unique: true },

  state: {
    type: String,
    enum: [
      "init",
      "awaiting_courier_type",
      "awaiting_pickup",
      "awaiting_drop",
      "awaiting_unit_info",
      "awaiting_basic_info",
      "awaiting_box_details",
      "awaiting_box_details_b2c",
      "awaiting_invoice_date",
      "awaiting_invoice_value",
      "awaiting_invoice_number",
      "awaiting_eway_bill_no",
      "awaiting_special_delivery",
      "awaiting_payment_mode",
      "awaiting_cod_info",
      "awaiting_rov_insurance",
      "awaiting_shipment_mode",
      "awaiting_order_ready_date",
      "awaiting_hsn_code",
      "awaiting_product_name",
      "awaiting_self_drop",
      "awaiting_courier_options",
      "awaiting_extra_info_1",
      "awaiting_extra_info_2",
      "awaiting_confirmation",
    ],
    default: "init",
  },

  courier_type: {
    type: String,
    enum: ["B2B", "B2C"],
    default: "B2B",
  },
  // warehouse selection
  pickupWarehouses: [Object],
  dropWarehouses: [Object],
  selectedPickupId: String,
  selectedDropId: String,

  // basic box info
  unitOfMeasurement: {
    type: String,
    enum: ["CM", "IN"],
    default: "CM",
  }, // e.g., kg, lbs
  totalBoxTypes: Number,
  boxDetails: [
    {
      count: Number,
      weightPerBox: Number,
      length: Number,
      width: Number,
      height: Number,
    },
  ],

  // invoice info
  invoiceDate: String, // or Date if you parse later
  invoiceValue: Number,
  ewayBillNo: { type: String, default: "" },
  invoiceNumber: String,

  // special delivery
  specialDeliveryType: String, // e.g., Standard, Express, SameDay

  // payment
  paymentMode: Number, // Prepaid, COD, etc
  codAmount: Number,

  // insurance
  rovInsuranceType: String, // eg. Basic, Premium

  // shipment mode
  shipmentMode: String, // Air, Road, Rail

  // other
  orderReadyDate: String, // or Date
  hsnCode: String,
  productName: String,
  selfDrop: {
    type: Boolean,
    default: false,
  },

  receipientGST: String,
  remarks: String,

  // chosen courier
  courierOptions: [Object],
  selectedCourier: Number,

  modeId:Number,
  orderId: Number, 
  shipmentId: Number, 

  createdAt: { type: Date, default: Date.now },
});

export default mongoose.model("BookShipment", bookShipmentSchema);
