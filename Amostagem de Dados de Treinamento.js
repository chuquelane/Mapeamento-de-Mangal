// Define a área de interesse (ROI)
var roi = ee.Geometry.Polygon([
  [
    [37.02597172735273, -17.81405861626271],
    [37.32946904180586, -17.81405861626271],
    [37.32946904180586, -17.604744688588962],
    [37.02597172735273, -17.604744688588962],
    [37.02597172735273, -17.81405861626271]
  ]
]);

// Centraliza o mapa na ROI com zoom 12
Map.centerObject(roi, 12);

// Define os parâmetros de estilo para a visualização do contorno da ROI
var styleParams = {
  color: 'black',  // Cor do contorno: preta
  width: 3         // Espessura do contorno
};

// Adiciona a ROI ao mapa com o estilo definido
Map.addLayer(roi, styleParams, 'Contorno da Área de Estudo');

// Função para mascarar nuvens e sombras na coleção Landsat 8
function maskL8sr(image) {
    // Máscara baseada no QA_PIXEL para nuvens e sombras de nuvens
    var qaMask = image.select(['QA_PIXEL']).bitwiseAnd(parseInt('111111', 2)).eq(0);
    
    // Máscara para saturação radiométrica
    var saturationMask = image.select("QA_RADSAT").eq(0);
    
    // Aplica os fatores de escala às bandas ópticas e termais
    var opticalBands = image.select("SR_B.").multiply(0.0000275).add(-0.2); // Bandas ópticas
    var thermalBands = image.select("ST_B.*").multiply(0.00341802).add(149.0); // Bandas termais
    
    // Aplica as máscaras e ajusta as bandas escalonadas
    return image
        .addBands(opticalBands, null, true)
        .addBands(thermalBands, null, true)
        .updateMask(qaMask)
        .updateMask(saturationMask)
        .clip(roi) // Recorta para a ROI
        .copyProperties(image, image.propertyNames()) // Mantém as propriedades originais
        .set({date: image.date().format('YYYY-MM-dd')}); // Define a data como metadado
}

// Função para calcular índices de vegetação e água
function indices(image) {
    // Índice de Vegetação Normalizado (NDVI) - Rouse, 1973
    var ndvi = image.normalizedDifference(['SR_B5', 'SR_B4']).rename('NDVI');
    
    // Índice de Vegetação de Mangal (MVI) - Baloloy et al., 2020
    var mvi = image.expression(
        '(NIR - GREEN) / (SWIR - GREEN)', {
          'NIR': image.select('SR_B5'),
          'GREEN': image.select('SR_B3'),
          'SWIR': image.select('SR_B6')
        }).rename('MVI');
    
    // Índice de Diferença Normalizada de Água (NDWI) - McFeeters, 1996
    var ndwi = image.normalizedDifference(['SR_B3', 'SR_B5']).rename('NDWI');
    
    // Adiciona os índices como bandas à imagem
    return image.addBands([ndvi, mvi, ndwi]);
}

// Importa a coleção Landsat 8 e aplica filtros e funções
var collection = ee.ImageCollection("LANDSAT/LC08/C02/T1_L2")
                    .filterDate('2021-01-01', '2021-12-31') // Período de interesse
                    .filterBounds(roi) // Recorte pela ROI
                    .filter(ee.Filter.lt('CLOUD_COVER', 1)) // Limita a cobertura de nuvens a menos de 1%
                    .map(maskL8sr) // Aplica a máscara de nuvens
                    .map(indices); // Adiciona os índices

// Imprime o número de imagens na coleção filtrada
print('Quantidade de imagens:', collection.size());

// Calcula a mediana da coleção para reduzir a variabilidade temporal
var collection_reduce = collection.median();
print('Bandas disponíveis:', collection_reduce.bandNames());

// Máscara de pixels com elevação abaixo de 50 m
var srtm = ee.Image('USGS/SRTMGL1_003'); // Dados de elevação SRTM
var elevation = srtm.select('elevation');
var masksrtm = collection_reduce.lt(50); // Mantém pixels abaixo de 50 m
var maskedsrtm = collection_reduce.updateMask(masksrtm); // Aplica a máscara

// Máscara para áreas terrestres com base em Hansen et al., 2015
var hansenImage = ee.Image('UMD/hansen/global_forest_change_2015');
var datamask = hansenImage.select('datamask');
var maskland = datamask.eq(1); // Mantém apenas pixels terrestres
var maskedcomposite = maskedsrtm.updateMask(maskland); // Aplica a máscara terrestre

// Adiciona a composição mascarada ao mapa como uma visualização RGB
Map.addLayer(maskedcomposite, {bands: ['SR_B4', 'SR_B3', 'SR_B2'], min: 0.01, max: 0.10}, 'Landsat RGB');

// Seleciona os mangais de 2020 a partir do dataset GMW
var mangrove2020 = ee.ImageCollection("projects/earthengine-legacy/assets/projects/sat-io/open-datasets/GMW/extent/GMW_V3")
                      .filterDate('2020-01-01', '2020-12-31');
var mang2020 = mangrove2020.mosaic().clip(roi); // Combina e recorta para a ROI

// Adiciona a camada de mangais ao mapa
Map.addLayer(mang2020, {min: 0, max: 1, palette: ['white', 'green']}, 'Mangais 2020');

// Exportação de áreas de mangal e não-mangal
// (Certifique-se de definir 'mangal' e 'naomangal' corretamente antes de exportar)
Export.table.toAsset({
  collection: mangal, // Deve ser definido no código
  description: 'Exportar_Mangal',
  assetId: 'users/chuquelane/mangal'
});

Export.table.toAsset({
  collection: naomangal, // Deve ser definido no código
  description: 'Exportar_naomangal',
  assetId: 'users/chuquelane/naomangal'
});
