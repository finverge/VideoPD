// getUserMedia's error .name distinguishes real, different causes — most
// importantly NotReadableError ("device already in use"), which is exactly
// what happens testing multiple camera features (the live call, the
// VideoPD liveness recording, the apply wizard's own camera capture) across
// several tabs/windows on one machine: most devices have exactly one
// camera, and it can't stream to two getUserMedia calls at once, so
// whichever tab asks second genuinely can't get a camera — a real hardware/
// browser constraint, not a bug in any of the call/recording logic. Shared
// between useCallRoom.ts and CameraCapture.tsx so both surface the same,
// actually-informative reason instead of each having its own narrower,
// less complete mapping (CameraCapture.tsx's only ever distinguished
// "denied" from "everything else", which read as a generic dead end
// exactly when this was the real cause — reported live as the camera
// "never opens / stays blank").
export function describeGetUserMediaError(name: string | undefined): string {
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "Camera/microphone access was denied. Please allow camera permission and try again.";
    case "NotReadableError":
    case "TrackStartError":
      return "Your camera or microphone is already in use by another tab or app — close whatever else has it open (this is the most common cause when testing multiple camera features in different tabs on the same computer, since most devices only have one camera).";
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No camera or microphone was found on this device.";
    case "OverconstrainedError":
      return "This device's camera doesn't support what's needed here.";
    default:
      return "Couldn't access a camera on this device.";
  }
}
