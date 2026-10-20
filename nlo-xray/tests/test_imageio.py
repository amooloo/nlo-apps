"""Reading DICOM and picture files, pixel size, names and dates."""
import io

import numpy as np
import pytest
from PIL import Image

from xray import imageio


def make_dicom(pixel_spacing=None, imager_spacing=None, mag=None, mono1=False, name="DOE^JANE", sex="F",
               dob="20120304", date="20261015", cal_type=None, bits=12):
    from pydicom.dataset import FileDataset, FileMetaDataset
    from pydicom.uid import ExplicitVRLittleEndian, generate_uid

    meta = FileMetaDataset()
    meta.MediaStorageSOPClassUID = "1.2.840.10008.5.1.4.1.1.1.1"   # Digital X-Ray Image
    meta.MediaStorageSOPInstanceUID = generate_uid()
    meta.TransferSyntaxUID = ExplicitVRLittleEndian
    ds = FileDataset("x.dcm", {}, file_meta=meta, preamble=b"\0" * 128)
    ds.PatientName = name
    ds.PatientSex = sex
    ds.PatientBirthDate = dob
    ds.StudyDate = date
    ds.Modality = "DX"
    ds.Manufacturer = "Carestream Health"
    ds.Rows, ds.Columns = 200, 300
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME1" if mono1 else "MONOCHROME2"
    ds.BitsAllocated, ds.BitsStored, ds.HighBit, ds.PixelRepresentation = 16, bits, bits - 1, 0
    arr = np.zeros((200, 300), np.uint16)
    arr[:, 150:] = (1 << bits) - 1          # right half bright (MONOCHROME2)
    ds.PixelData = arr.tobytes()
    if pixel_spacing:
        ds.PixelSpacing = [pixel_spacing, pixel_spacing]
    if imager_spacing:
        ds.ImagerPixelSpacing = [imager_spacing, imager_spacing]
    if mag:
        ds.EstimatedRadiographicMagnificationFactor = mag
    if cal_type:
        ds.PixelSpacingCalibrationType = cal_type
    buf = io.BytesIO()
    ds.save_as(buf, enforce_file_format=True)
    return buf.getvalue()


def test_dicom_detector_spacing_divided_by_office_magnification():
    img, meta = imageio.read_any(make_dicom(imager_spacing=0.1), "ceph.dcm", default_magnification=1.13)
    assert img.shape == (200, 300) and img.dtype == np.uint8
    assert img[:, :100].mean() < 20 and img[:, 200:].mean() > 235
    assert meta["mm_per_px"] == pytest.approx(0.1 / 1.13)
    assert "office setting" in meta["calibration"]
    assert meta["patient"] == "Doe, Jane" and meta["sex"] == "F"
    assert meta["dob"] == "2012-03-04" and meta["taken"] == "2026-10-15"


def test_dicom_magnification_from_the_file_wins():
    _, meta = imageio.read_any(make_dicom(imager_spacing=0.1, mag=1.1), "c.dcm", default_magnification=1.13)
    assert meta["mm_per_px"] == pytest.approx(0.1 / 1.1)
    assert "from the file" in meta["calibration"]


def test_dicom_calibrated_pixel_spacing_used_as_is():
    _, meta = imageio.read_any(make_dicom(pixel_spacing=0.088, imager_spacing=0.1), "c.dcm")
    assert meta["mm_per_px"] == pytest.approx(0.088)
    _, meta = imageio.read_any(make_dicom(pixel_spacing=0.1, imager_spacing=0.1, cal_type="GEOMETRY"), "c.dcm")
    assert meta["mm_per_px"] == pytest.approx(0.1)


def test_dicom_monochrome1_is_inverted_and_no_extension_is_fine():
    img, meta = imageio.read_any(make_dicom(mono1=True), "IMG0001")
    assert img[:, :100].mean() > 235 and img[:, 200:].mean() < 20
    assert meta["mm_per_px"] is None


def test_jpeg_has_no_pixel_size_and_names_come_from_the_file_name():
    a = (np.random.default_rng(0).random((300, 400)) * 255).astype(np.uint8)
    buf = io.BytesIO()
    Image.fromarray(a).save(buf, format="JPEG")
    img, meta = imageio.read_any(buf.getvalue(), "Jane_Doe_ceph_2026-10-15.jpg")
    assert img.shape == (300, 400)
    assert meta["mm_per_px"] is None
    assert meta["patient"] == "Jane Doe"
    assert meta["taken"] == "2026-10-15"


def test_rgb_png_to_grey_and_big_images_scaled():
    a = np.zeros((5000, 4200, 3), np.uint8)
    a[..., 0] = 200
    buf = io.BytesIO()
    Image.fromarray(a).save(buf, format="PNG")
    img, meta = imageio.read_any(buf.getvalue(), "x.png")
    assert max(img.shape) == imageio.MAX_SIDE
    assert meta["scaled"] < 1


def test_not_an_image():
    with pytest.raises(imageio.ImageReadError):
        imageio.read_any(b"hello world, not an image at all" * 10, "notes.txt")
    with pytest.raises(imageio.ImageReadError):
        imageio.read_any(b"\x00" * 500, "x.jpg")
