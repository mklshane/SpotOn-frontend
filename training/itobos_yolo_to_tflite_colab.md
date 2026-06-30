# Train a Skinive-style lesion detector (iToBoS → YOLOv8 → tflite)

Goal: a YOLOv8 detector trained on **clinical skin-patch images** (lesions as small objects), so the
live green box is **stable and tight** like Skinive's — unlike dermoscopy models, which box the whole
frame. Run this on **Google Colab with a GPU** (Runtime → Change runtime type → **T4 GPU**). Total
time ~1–2 hours. At the end you download one `.tflite` and hand it back; the app pipeline is already
built for it (single-class `[1,5,8400]` output, dynamic input size).

> Before you start: open https://www.kaggle.com/competitions/itobos-2024-detection/rules and click
> **"I Understand and Accept"** (required to download the data), and create a Kaggle API token at
> kaggle.com → Settings → **Create New Token** (downloads `kaggle.json`).

---

### Cell 1 — install
```python
!pip -q install ultralytics kaggle
```

### Cell 2 — Kaggle auth (upload your kaggle.json when prompted)
```python
from google.colab import files
files.upload()  # pick kaggle.json
!mkdir -p ~/.kaggle && cp kaggle.json ~/.kaggle/ && chmod 600 ~/.kaggle/kaggle.json
```

### Cell 3 — download + unzip the dataset
```python
!kaggle competitions download -c itobos-2024-detection
!unzip -q -o itobos-2024-detection.zip -d itobos
import subprocess; print(subprocess.run(['find','itobos','-maxdepth','3','-type','d'],capture_output=True,text=True).stdout)
```

### Cell 4 — locate images/labels and build a YOLO data.yaml (auto-detect + 90/10 split)
```python
import os, glob, random, shutil, yaml
random.seed(0)
ROOT='itobos'
# find the folder that has YOLO label .txt files
label_dirs=set(os.path.dirname(p) for p in glob.glob(f'{ROOT}/**/*.txt', recursive=True)
               if 'label' in p.lower() or os.path.basename(os.path.dirname(p)).lower() in ('labels','train'))
print('label dirs:', label_dirs)
# pick the label dir with the most txt files (the training labels)
lbl_dir=max(label_dirs, key=lambda d: len(glob.glob(f'{d}/*.txt'))) if label_dirs else None
assert lbl_dir, 'No YOLO label dir found — inspect the printed tree in Cell 3'
# find the matching images dir (sibling 'images', or same basenames as the labels)
cand=[d for d in glob.glob(f'{ROOT}/**/', recursive=True) if glob.glob(f'{d}/*.jpg')+glob.glob(f'{d}/*.png')]
img_dir=max(cand, key=lambda d: len(glob.glob(f'{d}/*.jpg')+glob.glob(f'{d}/*.png')))
print('images:', img_dir, ' labels:', lbl_dir)

# build train/val lists by matching basenames
imgs=[p for p in glob.glob(f'{img_dir}/*') if p.lower().endswith(('.jpg','.jpeg','.png'))]
def lbl_for(p): return os.path.join(lbl_dir, os.path.splitext(os.path.basename(p))[0]+'.txt')
imgs=[p for p in imgs if os.path.exists(lbl_for(p))]
random.shuffle(imgs); k=int(len(imgs)*0.9)
os.makedirs('ds/images/train',exist_ok=True); os.makedirs('ds/images/val',exist_ok=True)
os.makedirs('ds/labels/train',exist_ok=True); os.makedirs('ds/labels/val',exist_ok=True)
for split,part in (('train',imgs[:k]),('val',imgs[k:])):
    for p in part:
        shutil.copy(p, f'ds/images/{split}/{os.path.basename(p)}')
        shutil.copy(lbl_for(p), f'ds/labels/{split}/{os.path.splitext(os.path.basename(p))[0]}.txt')
print('train',len(imgs[:k]),'val',len(imgs[k:]))
yaml.safe_dump({'path':os.path.abspath('ds'),'train':'images/train','val':'images/val',
                'names':{0:'lesion'}}, open('data.yaml','w'))
print(open('data.yaml').read())
```

### Cell 4b — zoom-crop augmentation (so it ALSO detects LARGE / frame-filling lesions)
```python
# iToBoS lesions are small objects; this adds crops where a lesion fills the frame,
# so the detector works at all scales (small moles AND large melanoma/BCC/SCC).
import os, glob, random, cv2
random.seed(1)
def read_yolo(p):
    rows=[]
    for ln in open(p):
        v=ln.split()
        if len(v)==5: rows.append(tuple(map(float, v[1:])))
    return rows
added=0
for ip in glob.glob('ds/images/train/*'):
    lp='ds/labels/train/'+os.path.splitext(os.path.basename(ip))[0]+'.txt'
    if not os.path.exists(lp): continue
    boxes=read_yolo(lp)
    if not boxes: continue
    img=cv2.imread(ip)
    if img is None: continue
    H,W=img.shape[:2]
    bx,by,bw,bh=random.choice(boxes)
    side=random.uniform(1.2,2.2)*max(bw*W, bh*H)   # lesion fills ~45-80% of the crop
    side=int(min(side, W, H))
    if side<32: continue
    x0=int(min(max(bx*W-side/2,0),W-side)); y0=int(min(max(by*H-side/2,0),H-side))
    crop=img[y0:y0+side, x0:x0+side]
    nl=[]
    for x,y,w,h in boxes:
        nx=(x*W-x0)/side; ny=(y*H-y0)/side; nw=w*W/side; nh=h*H/side
        if 0<nx<1 and 0<ny<1:
            nl.append(f'0 {nx:.6f} {ny:.6f} {min(nw,0.99):.6f} {min(nh,0.99):.6f}')
    if not nl: continue
    b=os.path.splitext(os.path.basename(ip))[0]+'_zoom'
    cv2.imwrite(f'ds/images/train/{b}.jpg', crop)
    open(f'ds/labels/train/{b}.txt','w').write('\n'.join(nl))
    added+=1
print('added zoom-crops:', added)
```

### Cell 5 — train (YOLOv8n; ~1–1.5 hr on a T4)
```python
from ultralytics import YOLO
m = YOLO('yolov8n.pt')   # 'yolov8s.pt' = a bit more accurate, ~2x slower
m.train(data='data.yaml', imgsz=640, epochs=60, batch=16, patience=15,
        mosaic=1.0, scale=0.9, name='itobos_lesion')  # scale=0.9 = strong zoom jitter
```

### Cell 6 — export to tflite (float16)
```python
best = YOLO('runs/detect/itobos_lesion/weights/best.pt')
best.export(format='tflite', imgsz=640, half=True)
```

### Cell 7 — download the model
```python
from google.colab import files
files.download('runs/detect/itobos_lesion/weights/best_saved_model/best_float16.tflite')
```

---

## Then hand it to me
Drop `best_float16.tflite` into `SpotOn-frontend/assets/models/` (e.g. rename it
`itobos_lesion_float16.tflite`) or send me the path/URL. I will:
1. **Restore the detection camera** (revert the guided-framing screen back to the live detector — the
   box/unbox frame processor + YOLO decode is preserved and ready).
2. Point the `require(...)` at the new model (input size is already read dynamically).
3. Re-tune the score threshold with the on-device log sweep.
4. Verify on your phone — the box should now lock tightly onto moles like Skinive.

## Notes / knobs
- It's **single-class** ("lesion") — detects any lesion/mole (benign + malignant); your separate
  classifier handles the diagnosis on the crop.
- If small moles are still missed, bump `epochs` or use `yolov8s.pt`; if boxes feel loose, that's
  expected from the patch domain and improves with `imgsz=768`.
- iToBoS tiles show a wider skin area than a phone close-up, so there's a mild domain gap — still
  vastly better than dermoscopy. If you want to close it further, add a small set of your own phone
  photos (annotated in Roboflow) and fine-tune on top.
