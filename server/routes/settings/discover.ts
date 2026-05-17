import {
  DiscoverSliderType,
  MAX_DISCOVER_SLIDER_DATA_LENGTH,
  MAX_DISCOVER_SLIDER_TITLE_LENGTH,
  MAX_DISCOVER_SLIDERS,
} from '@server/constants/discover';
import { getRepository } from '@server/datasource';
import DiscoverSlider from '@server/entity/DiscoverSlider';
import logger from '@server/logger';
import { parsePositiveRouteId } from '@server/utils/routeId';
import { parseBoundedString } from '@server/utils/validation';
import { Router } from 'express';

const discoverSettingRoutes = Router();

const isValidSliderType = (value: unknown): value is DiscoverSliderType =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  Object.values(DiscoverSliderType).includes(value);

const parseSliderId = (value: unknown): number | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    return undefined;
  }

  return value;
};

const parseCustomSlider = (
  slider: Partial<DiscoverSlider>
):
  | { value: Pick<DiscoverSlider, 'data' | 'title' | 'type'> }
  | {
      error: string;
    } => {
  const title = parseBoundedString(slider.title, {
    fieldName: 'Slider title',
    maxLength: MAX_DISCOVER_SLIDER_TITLE_LENGTH,
  });

  if ('error' in title) {
    return title;
  }

  const data = parseBoundedString(slider.data, {
    fieldName: 'Slider data',
    maxLength: MAX_DISCOVER_SLIDER_DATA_LENGTH,
  });

  if ('error' in data) {
    return data;
  }

  if (!isValidSliderType(slider.type)) {
    return { error: 'Slider type is invalid.' };
  }

  return {
    value: {
      data: data.value,
      title: title.value,
      type: slider.type,
    },
  };
};

discoverSettingRoutes.post('/', async (req, res) => {
  const sliderRepository = getRepository(DiscoverSlider);

  const sliders = req.body as Partial<DiscoverSlider>[];

  if (!Array.isArray(sliders) || sliders.length > MAX_DISCOVER_SLIDERS) {
    return res.status(400).json({ message: 'Invalid request body.' });
  }

  const savedSliders: DiscoverSlider[] = [];

  for (let x = 0; x < sliders.length; x++) {
    const slider = sliders[x];
    const sliderId = parseSliderId(slider.id);

    if (slider.id !== undefined && slider.id !== null && !sliderId) {
      return res.status(400).json({ message: 'Slider id is invalid.' });
    }

    const existingSlider = await sliderRepository.findOne({
      where: {
        id: sliderId,
      },
    });

    if (existingSlider && sliderId) {
      existingSlider.enabled =
        typeof slider.enabled === 'boolean' ? slider.enabled : false;
      existingSlider.order = x;

      // Only allow changes to the following when the slider is not built in
      if (!existingSlider.isBuiltIn) {
        const parsedSlider = parseCustomSlider(slider);

        if ('error' in parsedSlider) {
          return res.status(400).json({ message: parsedSlider.error });
        }

        existingSlider.title = parsedSlider.value.title;
        existingSlider.data = parsedSlider.value.data;
        existingSlider.type = parsedSlider.value.type;
      }

      savedSliders.push(await sliderRepository.save(existingSlider));
    } else {
      const parsedSlider = parseCustomSlider(slider);

      if ('error' in parsedSlider) {
        return res.status(400).json({ message: parsedSlider.error });
      }

      const newSlider = new DiscoverSlider({
        isBuiltIn: false,
        data: parsedSlider.value.data,
        title: parsedSlider.value.title,
        enabled: typeof slider.enabled === 'boolean' ? slider.enabled : false,
        order: x,
        type: parsedSlider.value.type,
      });
      savedSliders.push(await sliderRepository.save(newSlider));
    }
  }

  return res.json(savedSliders);
});

discoverSettingRoutes.post('/add', async (req, res) => {
  const sliderRepository = getRepository(DiscoverSlider);

  const slider = req.body as DiscoverSlider;
  const parsedSlider = parseCustomSlider(slider);

  if ('error' in parsedSlider) {
    return res.status(400).json({ message: parsedSlider.error });
  }

  const newSlider = new DiscoverSlider({
    isBuiltIn: false,
    data: parsedSlider.value.data,
    title: parsedSlider.value.title,
    enabled: false,
    order: -1,
    type: parsedSlider.value.type,
  });
  await sliderRepository.save(newSlider);

  return res.json(newSlider);
});

discoverSettingRoutes.get('/reset', async (_req, res) => {
  const sliderRepository = getRepository(DiscoverSlider);

  await sliderRepository.clear();
  await DiscoverSlider.bootstrapSliders();

  return res.status(204).send();
});

discoverSettingRoutes.put('/:sliderId', async (req, res, next) => {
  const sliderRepository = getRepository(DiscoverSlider);
  const sliderId = parsePositiveRouteId(req.params.sliderId);
  if (!sliderId) {
    return next({
      status: 404,
      message: 'Slider not found or cannot be updated.',
    });
  }

  const slider = req.body as DiscoverSlider;
  const parsedSlider = parseCustomSlider(slider);

  if ('error' in parsedSlider) {
    return res.status(400).json({ message: parsedSlider.error });
  }

  try {
    const existingSlider = await sliderRepository.findOneOrFail({
      where: {
        id: sliderId,
      },
    });

    // Only allow changes to the following when the slider is not built in
    if (!existingSlider.isBuiltIn) {
      existingSlider.title = parsedSlider.value.title;
      existingSlider.data = parsedSlider.value.data;
      existingSlider.type = parsedSlider.value.type;
    }

    await sliderRepository.save(existingSlider);

    return res.status(200).json(existingSlider);
  } catch (e) {
    logger.error('Something went wrong updating a slider.', {
      label: 'API',
      errorMessage: e.message,
    });
    next({ status: 404, message: 'Slider not found or cannot be updated.' });
  }
});

discoverSettingRoutes.delete('/:sliderId', async (req, res, next) => {
  const sliderRepository = getRepository(DiscoverSlider);
  const sliderId = parsePositiveRouteId(req.params.sliderId);
  if (!sliderId) {
    return next({
      status: 404,
      message: 'Slider not found or cannot be deleted.',
    });
  }

  try {
    const slider = await sliderRepository.findOneOrFail({
      where: { id: sliderId, isBuiltIn: false },
    });

    await sliderRepository.remove(slider);

    return res.status(204).send();
  } catch (e) {
    logger.error('Something went wrong deleting a slider.', {
      label: 'API',
      errorMessage: e.message,
    });
    next({ status: 404, message: 'Slider not found or cannot be deleted.' });
  }
});

export default discoverSettingRoutes;
