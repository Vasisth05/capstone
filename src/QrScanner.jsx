import { useEffect, useRef, useState } from 'react'
import { BrowserCodeReader, BrowserQRCodeReader } from '@zxing/browser'
import { Camera, CameraOff, RotateCcw } from 'lucide-react'
import { translateText as t } from './services/translations.js'

function cameraError(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') return t('Camera permission was denied. Allow camera access in your browser settings, then try again.')
  if (error?.name === 'NotFoundError' || error?.name === 'DevicesNotFoundError') return t('No camera was found on this device. Enter the QR token manually instead.')
  if (error?.name === 'NotReadableError' || error?.name === 'TrackStartError') return t('The camera is busy in another app. Close that app and try again.')
  if (!globalThis.isSecureContext) return t('Camera access requires HTTPS or localhost. Use the manual token field on this connection.')
  return error?.message || t('The camera could not start. Check its permission and try again.')
}

export default function QrScanner({ onDecode }) {
  const videoRef = useRef(null)
  const controlsRef = useRef(null)
  const onDecodeRef = useRef(onDecode)
  const [running, setRunning] = useState(false)
  const [devices, setDevices] = useState([])
  const [deviceId, setDeviceId] = useState('')
  const [error, setError] = useState('')

  useEffect(() => { onDecodeRef.current = onDecode }, [onDecode])

  useEffect(() => {
    if (!running) return undefined
    let active = true
    let delivered = false
    const reader = new BrowserQRCodeReader()

    reader.decodeFromVideoDevice(deviceId || undefined, videoRef.current, (result, _scanError, controls) => {
      controlsRef.current = controls
      if (!active || delivered || !result) return
      delivered = true
      controls.stop()
      setRunning(false)
      setError('')
      onDecodeRef.current(result.getText())
    }).then((controls) => {
      controlsRef.current = controls
      if (!active) controls.stop()
    }).catch((scanError) => {
      if (active) {
        setError(cameraError(scanError))
        setRunning(false)
      }
    })

    BrowserCodeReader.listVideoInputDevices().then((inputs) => {
      if (!active) return
      setDevices(inputs)
      if (!deviceId && inputs.length > 1) {
        const rear = inputs.find((input) => /back|rear|environment/i.test(input.label))
        setDeviceId((rear ?? inputs[inputs.length - 1]).deviceId)
      }
    }).catch(() => {})

    return () => {
      active = false
      controlsRef.current?.stop()
      controlsRef.current = null
    }
  }, [running, deviceId])

  const start = () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(t('Camera access is unavailable in this browser. Enter the QR token manually instead.'))
      return
    }
    setError('')
    setRunning(true)
  }

  return <div className="qr-scanner">
    <div className="qr-scanner-heading"><strong>{t('Scan student QR')}</strong><span>{t('Camera stays on this device.')}</span></div>
    {running && <video ref={videoRef} className="qr-video" muted playsInline aria-label={t('Camera preview for QR scanning')} />}
    {!running && <div className="qr-camera-placeholder"><Camera size={22} /><span>{error ? t('Camera not active') : t('Start the camera to scan a code')}</span></div>}
    {devices.length > 1 && <label className="form-label">{t('Camera')}<select value={deviceId} onChange={(event) => setDeviceId(event.target.value)}>{devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `${t('Camera')} ${index + 1}`}</option>)}</select></label>}
    {error && <p className="report-error" role="alert">{error}</p>}
    <button type="button" className="secondary-button" onClick={running ? () => setRunning(false) : start}>{running ? <><CameraOff size={15} />{t('Stop camera')}</> : error ? <><RotateCcw size={15} />{t('Try camera again')}</> : <><Camera size={15} />{t('Start camera')}</>}</button>
  </div>
}

