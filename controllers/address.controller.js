const asyncHandler = require("../shared/utils/asyncHandler");
const ApiError = require("../shared/utils/ApiError");
const ApiResponse = require("../shared/utils/ApiResponse");
const User = require("../models/user.model");

// ---- ADD a new address ----
const addAddress = asyncHandler(async (req, res) => {
  const { fullName, phone, addressLine1, addressLine2, city, state, pincode, country, isDefault } = req.body;

  if (!fullName || !phone || !addressLine1 || !city || !state || !pincode) {
    throw new ApiError(400, "Please provide all required address fields");
  }

  const user = await User.findById(req.user._id);

  // if this is marked default, unset default on all existing addresses first
  if (isDefault) {
    user.addresses.forEach((addr) => (addr.isDefault = false));
  }

  // if this is the user's very first address, make it default automatically
  const shouldBeDefault = isDefault || user.addresses.length === 0;

  user.addresses.push({
    fullName,
    phone,
    addressLine1,
    addressLine2,
    city,
    state,
    pincode,
    country: country || "India",
    isDefault: shouldBeDefault,
  });

  await user.save({ validateBeforeSave: false });

  return res
    .status(201)
    .json(new ApiResponse(201, user.addresses, "Address added successfully"));
});

// ---- GET all addresses for logged-in user ----
const getAddresses = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).select("addresses");

  if (!user) {
    return res
      .status(200)
      .json(new ApiResponse(200, [], "No addresses found"));
  }

  return res
    .status(200)
    .json(new ApiResponse(200, user.addresses || [], "Addresses fetched successfully"));
});

// ---- UPDATE a specific address ----
const updateAddress = asyncHandler(async (req, res) => {
  const { addressId } = req.params;
  const { fullName, phone, addressLine1, addressLine2, city, state, pincode, country } = req.body;

  const user = await User.findById(req.user._id);

  const address = user.addresses.id(addressId);
  if (!address) {
    throw new ApiError(404, "Address not found");
  }

  if (fullName) address.fullName = fullName;
  if (phone) address.phone = phone;
  if (addressLine1) address.addressLine1 = addressLine1;
  if (addressLine2 !== undefined) address.addressLine2 = addressLine2;
  if (city) address.city = city;
  if (state) address.state = state;
  if (pincode) address.pincode = pincode;
  if (country) address.country = country;

  await user.save({ validateBeforeSave: false });

  return res
    .status(200)
    .json(new ApiResponse(200, user.addresses, "Address updated successfully"));
});

// ---- DELETE a specific address ----
const deleteAddress = asyncHandler(async (req, res) => {
  const { addressId } = req.params;

  const user = await User.findById(req.user._id);

  const address = user.addresses.id(addressId);
  if (!address) {
    throw new ApiError(404, "Address not found");
  }

  const wasDefault = address.isDefault;
  address.deleteOne(); // removes this subdocument from the array

  // if the deleted address was the default one, promote another as default (if any remain)
  if (wasDefault && user.addresses.length > 0) {
    user.addresses[0].isDefault = true;
  }

  await user.save({ validateBeforeSave: false });

  return res
    .status(200)
    .json(new ApiResponse(200, user.addresses, "Address deleted successfully"));
});

// ---- SET an address as default ----
const setDefaultAddress = asyncHandler(async (req, res) => {
  const { addressId } = req.params;

  const user = await User.findById(req.user._id);

  const address = user.addresses.id(addressId);
  if (!address) {
    throw new ApiError(404, "Address not found");
  }

  user.addresses.forEach((addr) => {
    addr.isDefault = addr._id.toString() === addressId;
  });

  await user.save({ validateBeforeSave: false });

  return res
    .status(200)
    .json(new ApiResponse(200, user.addresses, "Default address updated"));
});

module.exports = {
  addAddress,
  getAddresses,
  updateAddress,
  deleteAddress,
  setDefaultAddress,
};