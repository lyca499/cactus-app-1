import NitroModules
import UIKit

class HybridCactusDeviceInfo: HybridCactusDeviceInfoSpec {
  func getAppIdentifier() throws -> Promise<String?> {
    return Promise.async { Bundle.main.bundleIdentifier }
  }

  func getDeviceInfo() throws -> Promise<DeviceInfo> {
    return Promise.async {
      let device = await MainActor.run { UIDevice.current }
      return await DeviceInfo(
        brand: "Apple",
        model: self.deviceModelIdentifier(),
        device_id: device.identifierForVendor?.uuidString,
        os: device.systemName,
        os_version: device.systemVersion
      )
    }
  }
  
  private func deviceModelIdentifier() -> String {
    var systemInfo = utsname()
    uname(&systemInfo)
    let machineMirror = Mirror(reflecting: systemInfo.machine)
    let identifier = machineMirror.children.reduce("") { identifier, element in
      guard let value = element.value as? Int8, value != 0 else { return identifier }
      return identifier + String(UnicodeScalar(UInt8(value)))
    }
    return identifier
  }
}
