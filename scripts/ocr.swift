import Vision
import AppKit

guard CommandLine.arguments.count > 1 else {
    print("Usage: ocr <image-path>")
    exit(1)
}

let imagePath = CommandLine.arguments[1]
let imageUrl = URL(fileURLWithPath: imagePath)

guard let image = NSImage(contentsOf: imageUrl),
      let tiffData = image.tiffRepresentation,
      let ciImage = CIImage(data: tiffData) else {
    print("Error: Could not load image")
    exit(1)
}

let requestHandler = VNImageRequestHandler(ciImage: ciImage, options: [:])
let request = VNRecognizeTextRequest { (request, error) in
    guard let observations = request.results as? [VNRecognizedTextObservation] else { return }
    for observation in observations {
        let topCandidate = observation.topCandidates(1).first
        if let text = topCandidate?.string {
            print(text)
        }
    }
}

request.recognitionLevel = .accurate

do {
    try requestHandler.perform([request])
} catch {
    print("Error: \(error)")
    exit(1)
}
