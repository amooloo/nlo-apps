"""Reader checks on synthetic exports: shuffled names, a scout series next to the CBCT, a multi-frame file,
implicit VR, an oblique-free 2D image that must be refused.   python tools/test_dicom.py"""
import os, sys, tempfile, shutil, random
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import pydicom
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.sequence import Sequence
from pydicom.uid import ExplicitVRLittleEndian, ImplicitVRLittleEndian, generate_uid, CTImageStorage
from tadguide import dicomio


def base(rows, cols, ts=ExplicitVRLittleEndian, series=None):
    fm = FileMetaDataset()
    fm.MediaStorageSOPClassUID = CTImageStorage
    fm.MediaStorageSOPInstanceUID = generate_uid()
    fm.TransferSyntaxUID = ts
    ds = Dataset()
    ds.file_meta = fm
    ds.SOPClassUID = CTImageStorage
    ds.SOPInstanceUID = fm.MediaStorageSOPInstanceUID
    ds.PatientName = "Test^Case"
    ds.Modality = "CT"
    ds.SeriesInstanceUID = series or generate_uid()
    ds.Rows, ds.Columns = rows, cols
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.BitsAllocated, ds.BitsStored, ds.HighBit, ds.PixelRepresentation = 16, 16, 15, 1
    ds.PixelSpacing = [0.3, 0.25]
    ds.ImageOrientationPatient = [1, 0, 0, 0, 1, 0]
    return ds


def series(folder, vol, ts=ExplicitVRLittleEndian, slope=1, inter=0, shuffle=True):
    uid = generate_uid()
    names = [f"{random.randint(0, 10**9):09d}.dcm" for _ in range(vol.shape[0])]
    for k in range(vol.shape[0]):
        ds = base(vol.shape[1], vol.shape[2], ts, uid)
        ds.ImagePositionPatient = [-10.0, -20.0, 5.0 + 0.4 * k]
        ds.InstanceNumber = vol.shape[0] - k if shuffle else k + 1
        ds.RescaleSlope, ds.RescaleIntercept = slope, inter
        ds.PixelData = ((vol[k] - inter) / slope).astype(np.int16).tobytes()
        ds.save_as(os.path.join(folder, names[k]), enforce_file_format=True)


def main():
    rng = np.random.default_rng(0)
    vol = rng.integers(-1000, 3000, (24, 40, 50)).astype(np.int16)
    tmp = tempfile.mkdtemp()
    try:
        # 1. shuffled file names + a 3-image scout series + a text file
        d1 = os.path.join(tmp, "a"); os.makedirs(d1)
        series(d1, vol, slope=1, inter=-1000)
        series(d1, rng.integers(0, 100, (3, 64, 64)).astype(np.int16))
        open(os.path.join(d1, "notes.txt"), "w").write("x")
        v = dicomio.load([d1])
        assert v.data.shape == vol.shape, v.data.shape
        assert np.array_equal(v.data, vol), "data mismatch"
        assert np.allclose(v.spacing, (0.25, 0.3, 0.4)), v.spacing
        assert np.allclose(v.index_to_mm([0, 0, 0]), [-10, -20, 5])
        assert np.allclose(v.index_to_mm([2, 1, 3]), [-10 + 0.5, -20 + 0.3, 5 + 1.2])
        print("series + scout + shuffled: ok")
        # 2. implicit VR little endian
        d2 = os.path.join(tmp, "b"); os.makedirs(d2)
        series(d2, vol, ts=ImplicitVRLittleEndian)
        assert np.array_equal(dicomio.load([d2]).data, vol)
        print("implicit VR: ok")
        # 3. one multi-frame file with per-frame positions, frames stored in reverse order
        d3 = os.path.join(tmp, "c"); os.makedirs(d3)
        ds = base(vol.shape[1], vol.shape[2])
        ds.NumberOfFrames = vol.shape[0]
        pf = []
        for k in range(vol.shape[0]):
            fr = Dataset(); pp = Dataset()
            pp.ImagePositionPatient = [-10.0, -20.0, 5.0 + 0.4 * (vol.shape[0] - 1 - k)]
            fr.PlanePositionSequence = Sequence([pp])
            pf.append(fr)
        ds.PerFrameFunctionalGroupsSequence = Sequence(pf)
        ds.RescaleSlope, ds.RescaleIntercept = 1, 0
        ds.PixelData = vol[::-1].astype(np.int16).tobytes()
        ds.save_as(os.path.join(d3, "multi.dcm"), enforce_file_format=True)
        v3 = dicomio.load([d3])
        assert np.array_equal(v3.data, vol), "multi-frame order"
        print("multi-frame: ok")
        # 4. a single 2D image is refused with a readable message
        d4 = os.path.join(tmp, "d"); os.makedirs(d4)
        series(d4, vol[:2])
        try:
            dicomio.load([d4]); raise AssertionError("2D accepted")
        except dicomio.DicomError as ex:
            print("2D refused: ok -", ex)
        # 5. nothing DICOM at all
        d5 = os.path.join(tmp, "e"); os.makedirs(d5)
        open(os.path.join(d5, "x.bin"), "wb").write(os.urandom(4000))
        try:
            dicomio.load([d5]); raise AssertionError("junk accepted")
        except dicomio.DicomError as ex:
            print("junk refused: ok -", ex)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print("ALL OK")


if __name__ == "__main__":
    main()
